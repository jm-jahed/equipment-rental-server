import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import { Equipment, IEquipment, RentalType, EquipmentStatus } from "../models/Equipment";
import { verifyToken, verifyOwner, verifyAdmin, AuthRequest } from "../middlewares/auth";

const router = Router();

/**
 * Safely escapes regular expression special characters to treat user input as literal text.
 * Prevents regex injection and syntax errors with characters like (, [, +, ?, *, ., etc.
 */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * GET /api/equipment/featured
 * Public route to retrieve 6 approved equipment items for the home page.
 * Uses MongoDB .limit(6) per assignment specification.
 * Security: Populates only public owner fields (name, image); email/phone are withheld.
 */
router.get("/featured", async (req: Request, res: Response) => {
  try {
    const featuredItems = await Equipment.find({ status: "Approved" })
      .sort({ createdAt: -1 })
      .limit(6)
      .populate("ownerId", "name image");

    return res.status(200).json({
      success: true,
      count: featuredItems.length,
      data: featuredItems,
    });
  } catch (error: any) {
    console.error("Error fetching featured equipment:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch featured equipment items.",
      error: error.message,
    });
  }
});

/**
 * GET /api/equipment/owner/my-equipment
 * Protected route for Equipment Owners (and Admins) to view their own equipment listings.
 */
router.get("/owner/my-equipment", verifyToken, verifyOwner, async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = req.user?.id;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 10);
    const skip = (page - 1) * limit;

    const query: any = { ownerId: new mongoose.Types.ObjectId(ownerId) };

    if (req.query.status && ["Pending", "Approved", "Rejected"].includes(req.query.status as string)) {
      query.status = req.query.status;
    }

    const total = await Equipment.countDocuments(query);
    const items = await Equipment.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      success: true,
      count: items.length,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
      data: items,
    });
  } catch (error: any) {
    console.error("Error fetching owner equipment:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch owner equipment listings.",
      error: error.message,
    });
  }
});

/**
 * GET /api/equipment/admin/all
 * Protected route for Administrators to view and manage all platform equipment.
 */
router.get("/admin/all", verifyToken, verifyAdmin, async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 10);
    const skip = (page - 1) * limit;

    const query: any = {};

    if (req.query.status && ["Pending", "Approved", "Rejected"].includes(req.query.status as string)) {
      query.status = req.query.status;
    }

    if (req.query.search) {
      const safeSearch = escapeRegex(String(req.query.search).trim());
      const searchRegex = new RegExp(safeSearch, "i");
      query.$or = [{ name: searchRegex }, { category: searchRegex }, { location: searchRegex }];
    }

    const total = await Equipment.countDocuments(query);
    const items = await Equipment.find(query)
      .populate("ownerId", "name email role phone image")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      success: true,
      count: items.length,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
      data: items,
    });
  } catch (error: any) {
    console.error("Error fetching admin equipment:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch admin equipment list.",
      error: error.message,
    });
  }
});

/**
 * GET /api/equipment
 * Public route to browse all approved equipment with dynamic server-side search,
 * filtering, sorting, and pagination (Assignment 9 Challenge 1).
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const {
      search,
      category,
      rentalType,
      minPrice,
      maxPrice,
      availability,
      sortBy = "recent",
      page: queryPage = "1",
      limit: queryLimit = "9",
    } = req.query;

    const page = Math.max(1, parseInt(queryPage as string) || 1);
    const limit = Math.max(1, parseInt(queryLimit as string) || 9);
    const skip = (page - 1) * limit;

    // Strict constraint: Public browsing only displays approved equipment
    const query: any = { status: "Approved" };

    // 1. Dynamic Server-Side Search (Challenge 1: by Title/Name, Location, Category)
    // Escaped to treat regex characters like (, [, +, ?, *, . as literal strings
    if (search && typeof search === "string" && search.trim().length > 0) {
      const safeSearch = escapeRegex(search.trim());
      const searchRegex = new RegExp(safeSearch, "i");
      query.$or = [
        { name: searchRegex },
        { location: searchRegex },
        { category: searchRegex },
        { description: searchRegex },
      ];
    }

    // 2. Category Filter (safely escaped)
    if (category && typeof category === "string" && category !== "All" && category.trim().length > 0) {
      const safeCategory = escapeRegex(category.trim());
      query.category = new RegExp(`^${safeCategory}$`, "i");
    }

    // 3. Rental Type Filter (Daily, Weekly, Monthly)
    if (rentalType && typeof rentalType === "string" && rentalType !== "All") {
      query.rentalType = rentalType;
    }

    // 4. Price Range Filter (minPrice, maxPrice)
    const min = parseFloat(minPrice as string);
    const max = parseFloat(maxPrice as string);
    if (!isNaN(min) || !isNaN(max)) {
      query.rentalPrice = {};
      if (!isNaN(min)) query.rentalPrice.$gte = min;
      if (!isNaN(max)) query.rentalPrice.$lte = max;
    }

    // 5. Availability Filter
    if (availability === "available" || availability === "true") {
      query.availableQuantity = { $gt: 0 };
    }

    // 6. Sorting
    let sortOptions: any = { createdAt: -1 };
    switch (sortBy) {
      case "price_asc":
        sortOptions = { rentalPrice: 1 };
        break;
      case "price_desc":
        sortOptions = { rentalPrice: -1 };
        break;
      case "recent":
      default:
        sortOptions = { createdAt: -1 };
        break;
    }

    // Execute query with count
    // Security: Public catalog populates only name and image; email/phone are withheld
    const total = await Equipment.countDocuments(query);
    const items = await Equipment.find(query)
      .populate("ownerId", "name image")
      .sort(sortOptions)
      .skip(skip)
      .limit(limit);

    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      count: items.length,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      data: items,
    });
  } catch (error: any) {
    console.error("Error fetching all equipment:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching equipment list.",
      error: error.message,
    });
  }
});

/**
 * GET /api/equipment/:id
 * Protected route to retrieve single equipment details with full Owner Information.
 * Requires authenticated session (Customer, Owner, Admin) per assignment private route specification.
 * Unauthenticated users are barred from harvesting Owner email/phone.
 */
router.get("/:id", verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({
        success: false,
        message: "Invalid equipment ID format.",
      });
    }

    const item = await Equipment.findById(id).populate("ownerId", "name email phone image");

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Equipment item not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: item,
    });
  } catch (error: any) {
    console.error("Error fetching equipment by ID:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve equipment details.",
      error: error.message,
    });
  }
});

/**
 * POST /api/equipment
 * Protected route to create new equipment.
 * Requires Owner or Admin role. Never trusts client-supplied ownerId.
 */
router.post("/", verifyToken, verifyOwner, async (req: AuthRequest, res: Response) => {
  try {
    const {
      name,
      description,
      category,
      rentalPrice,
      rentalType = "Daily",
      location,
      availableQuantity = 1,
      condition = "Good",
      brand = "",
      model = "",
      image,
      rentalTerms = "",
    } = req.body;

    // Field validation
    if (!name || !description || !category || rentalPrice === undefined || !location || !image) {
      return res.status(400).json({
        success: false,
        message: "Name, description, category, rentalPrice, location, and image are required fields.",
      });
    }

    const price = Number(rentalPrice);
    if (isNaN(price) || price < 0) {
      return res.status(400).json({
        success: false,
        message: "Rental price must be a non-negative number.",
      });
    }

    const quantity = Number(availableQuantity);
    if (isNaN(quantity) || quantity < 0) {
      return res.status(400).json({
        success: false,
        message: "Available quantity must be a non-negative number.",
      });
    }

    // Role-enforced ownership: strictly assign ownerId from verified token
    const ownerId = new mongoose.Types.ObjectId(req.user?.id);

    // Initial status: Admins can set status directly; Owners always default to "Pending"
    const status: EquipmentStatus =
      req.user?.role === "Admin" && req.body.status && ["Pending", "Approved", "Rejected"].includes(req.body.status)
        ? req.body.status
        : "Pending";

    const newEquipment = await Equipment.create({
      name: name.trim(),
      description: description.trim(),
      category: category.trim(),
      rentalPrice: price,
      rentalType: rentalType as RentalType,
      location: location.trim(),
      availableQuantity: quantity,
      condition: condition.trim(),
      brand: brand.trim(),
      model: model.trim(),
      image: image.trim(),
      rentalTerms: rentalTerms.trim(),
      status,
      ownerId,
    });

    return res.status(201).json({
      success: true,
      message: "Equipment listed successfully. Awaiting administrator approval.",
      data: newEquipment,
    });
  } catch (error: any) {
    console.error("Error creating equipment:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to list equipment.",
      error: error.message,
    });
  }
});

/**
 * PATCH /api/equipment/:id
 * Protected route to update equipment details.
 * Owners can only update their own listings; Admins can update any listing.
 */
router.patch("/:id", verifyToken, verifyOwner, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({
        success: false,
        message: "Invalid equipment ID format.",
      });
    }

    const equipment = await Equipment.findById(id);
    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: "Equipment item not found.",
      });
    }

    // Security: Ownership check
    const isOwner = equipment.ownerId.toString() === req.user?.id;
    const isAdmin = req.user?.role === "Admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Forbidden. You can only edit equipment that you own.",
      });
    }

    const updates = req.body;
    const allowedFields = [
      "name",
      "description",
      "category",
      "rentalPrice",
      "rentalType",
      "location",
      "availableQuantity",
      "condition",
      "brand",
      "model",
      "image",
      "rentalTerms",
    ];

    allowedFields.forEach((field) => {
      if (updates[field] !== undefined) {
        (equipment as any)[field] = updates[field];
      }
    });

    // Only Admin can update status directly via this endpoint
    if (isAdmin && updates.status && ["Pending", "Approved", "Rejected"].includes(updates.status)) {
      equipment.status = updates.status;
    }

    await equipment.save();

    return res.status(200).json({
      success: true,
      message: "Equipment updated successfully.",
      data: equipment,
    });
  } catch (error: any) {
    console.error("Error updating equipment:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update equipment.",
      error: error.message,
    });
  }
});

/**
 * PATCH /api/equipment/:id/status
 * Protected route for Administrators to approve or reject equipment.
 */
router.patch("/:id/status", verifyToken, verifyAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({
        success: false,
        message: "Invalid equipment ID format.",
      });
    }

    if (!status || !["Pending", "Approved", "Rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Valid status required: 'Pending', 'Approved', or 'Rejected'.",
      });
    }

    const equipment = await Equipment.findById(id);
    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: "Equipment item not found.",
      });
    }

    equipment.status = status;
    await equipment.save();

    return res.status(200).json({
      success: true,
      message: `Equipment status updated to '${status}' successfully.`,
      data: equipment,
    });
  } catch (error: any) {
    console.error("Error updating equipment status:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update equipment status.",
      error: error.message,
    });
  }
});

/**
 * DELETE /api/equipment/:id
 * Protected route to delete equipment.
 * Owners can delete only their own equipment; Admins can delete any.
 */
router.delete("/:id", verifyToken, verifyOwner, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({
        success: false,
        message: "Invalid equipment ID format.",
      });
    }

    const equipment = await Equipment.findById(id);
    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: "Equipment item not found.",
      });
    }

    // Security: Ownership check
    const isOwner = equipment.ownerId.toString() === req.user?.id;
    const isAdmin = req.user?.role === "Admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Forbidden. You can only delete equipment that you own.",
      });
    }

    await equipment.deleteOne();

    return res.status(200).json({
      success: true,
      message: "Equipment deleted successfully.",
    });
  } catch (error: any) {
    console.error("Error deleting equipment:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete equipment item.",
      error: error.message,
    });
  }
});

export default router;
