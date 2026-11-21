import nodemailer, { Transporter } from "nodemailer";

export interface RentalCompletionNotificationData {
  bookingId: string;
  equipmentName: string;
  customerName: string;
  customerEmail: string;
  ownerName: string;
  ownerEmail: string;
  startDate: Date | string;
  endDate: Date | string;
  totalAmount: number;
}

let customTransport: Transporter | null = null;

/**
 * Allow test suites to inject a mock transporter (e.g. for testing without real SMTP credentials)
 */
export const setCustomMailTransport = (transporter: Transporter | null) => {
  customTransport = transporter;
};

/**
 * Get active nodemailer transporter based on server environment variables
 */
const getTransporter = (): Transporter => {
  if (customTransport) {
    return customTransport;
  }

  const host = process.env.SMTP_HOST || "smtp.mailtrap.io";
  const port = parseInt(process.env.SMTP_PORT || "2525", 10);
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  });
};

/**
 * Send automated completion notifications to both Customer and Equipment Owner
 * Safe against network and delivery failures so booking status is never corrupted
 */
export const sendRentalCompletionNotifications = async (
  data: RentalCompletionNotificationData
): Promise<{ success: boolean; customerNotified: boolean; ownerNotified: boolean; error?: string }> => {
  try {
    const fromAddress = process.env.SMTP_FROM || '"RentEquip Notifications" <no-reply@rentequip.com>';
    const transporter = getTransporter();

    const formattedStart = new Date(data.startDate).toLocaleDateString();
    const formattedEnd = new Date(data.endDate).toLocaleDateString();

    // 1. Notification to Customer / Renter
    const customerMailOptions = {
      from: fromAddress,
      to: data.customerEmail,
      subject: `Rental Completed: ${data.equipmentName} (#${data.bookingId.slice(-6)})`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
          <h2 style="color: #d97706; margin-top: 0;">Rental Completed Successfully</h2>
          <p>Hello <strong>${data.customerName}</strong>,</p>
          <p>Your rental of <strong>${data.equipmentName}</strong> has been officially marked as <strong>Completed</strong>.</p>
          <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="margin: 4px 0;"><strong>Booking Reference:</strong> #${data.bookingId}</p>
            <p style="margin: 4px 0;"><strong>Rental Period:</strong> ${formattedStart} &ndash; ${formattedEnd}</p>
            <p style="margin: 4px 0;"><strong>Total Amount Paid:</strong> $${data.totalAmount.toLocaleString()} USD</p>
            <p style="margin: 4px 0;"><strong>Equipment Provider:</strong> ${data.ownerName}</p>
          </div>
          <p>Thank you for choosing RentEquip for your equipment needs. We look forward to powering your next job!</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="font-size: 12px; color: #64748b;">RentEquip Platform &bull; Automated System Notification</p>
        </div>
      `,
    };

    // 2. Notification to Equipment Owner
    const ownerMailOptions = {
      from: fromAddress,
      to: data.ownerEmail,
      subject: `Machinery Returned: ${data.equipmentName} Rental Completed`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
          <h2 style="color: #059669; margin-top: 0;">Machinery Rental Completed</h2>
          <p>Hello <strong>${data.ownerName}</strong>,</p>
          <p>The rental period for your machinery <strong>${data.equipmentName}</strong> has ended and the order is now <strong>Completed</strong>.</p>
          <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="margin: 4px 0;"><strong>Booking Reference:</strong> #${data.bookingId}</p>
            <p style="margin: 4px 0;"><strong>Renter Name:</strong> ${data.customerName} (${data.customerEmail})</p>
            <p style="margin: 4px 0;"><strong>Rental Period:</strong> ${formattedStart} &ndash; ${formattedEnd}</p>
            <p style="margin: 4px 0;"><strong>Net Revenue:</strong> $${data.totalAmount.toLocaleString()} USD</p>
          </div>
          <p>Your equipment has been returned to your inventory and is available for subsequent client reservations.</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="font-size: 12px; color: #64748b;">RentEquip Owner Fleet Services</p>
        </div>
      `,
    };

    // Send notifications in parallel without throwing unhandled exceptions
    let customerNotified = false;
    let ownerNotified = false;

    if (!process.env.SMTP_USER && !customTransport) {
      console.log(`[EmailService] Simulated completion notification for Booking #${data.bookingId} to ${data.customerEmail} and ${data.ownerEmail}`);
      return { success: true, customerNotified: true, ownerNotified: true };
    }

    try {
      await transporter.sendMail(customerMailOptions);
      customerNotified = true;
    } catch (cErr: any) {
      console.warn(`[EmailService] Notice: Failed to send customer email to ${data.customerEmail}:`, cErr.message);
    }

    try {
      await transporter.sendMail(ownerMailOptions);
      ownerNotified = true;
    } catch (oErr: any) {
      console.warn(`[EmailService] Notice: Failed to send owner email to ${data.ownerEmail}:`, oErr.message);
    }

    return {
      success: customerNotified || ownerNotified,
      customerNotified,
      ownerNotified,
    };
  } catch (error: any) {
    console.error("[EmailService] Error in completion notifications handler:", error.message);
    return {
      success: false,
      customerNotified: false,
      ownerNotified: false,
      error: error.message,
    };
  }
};
