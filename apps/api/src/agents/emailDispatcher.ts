import nodemailer from "nodemailer";

export interface SendEmailOptions {
  draftId: string;
  recipientAddress: string;
  subject: string;
  body: string;
  opportunityId?: string;
  candidateName?: string;
  candidateEmail?: string;
  userExplicitlyApproved: boolean;
}

export interface EmailDispatchResult {
  success: boolean;
  status: "sent" | "rate_limited" | "duplicate_suppressed" | "approval_required" | "unconfigured" | "failed";
  messageId?: string;
  timestamp: string;
  message: string;
  errorDetails?: string;
}

// In-memory audit history for duplicate prevention and rate limiting
interface SentRecord {
  recipient: string;
  opportunityId?: string;
  sentAt: number;
}

const sentHistory: SentRecord[] = [];

const MAX_EMAILS_PER_HOUR = 5;
const MAX_EMAILS_PER_DAY = 20;
const DUPLICATE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Checks rate limits and duplicate suppression.
 */
function checkGuardrails(recipient: string, opportunityId?: string): { allowed: boolean; reason?: string; status?: EmailDispatchResult["status"] } {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  // 1. Duplicate prevention
  const recentToRecipient = sentHistory.find(
    r => r.recipient.toLowerCase() === recipient.toLowerCase() && (now - r.sentAt) < DUPLICATE_COOLDOWN_MS
  );
  if (recentToRecipient) {
    return {
      allowed: false,
      status: "duplicate_suppressed",
      reason: `Duplicate prevented: An outreach email was already sent to ${recipient} within the last 30 days.`
    };
  }

  // 2. Hourly rate limit
  const countPastHour = sentHistory.filter(r => r.sentAt > oneHourAgo).length;
  if (countPastHour >= MAX_EMAILS_PER_HOUR) {
    return {
      allowed: false,
      status: "rate_limited",
      reason: `Rate limit reached: Maximum ${MAX_EMAILS_PER_HOUR} outreach emails per hour allowed.`
    };
  }

  // 3. Daily rate limit
  const countPastDay = sentHistory.filter(r => r.sentAt > oneDayAgo).length;
  if (countPastDay >= MAX_EMAILS_PER_DAY) {
    return {
      allowed: false,
      status: "rate_limited",
      reason: `Rate limit reached: Maximum ${MAX_EMAILS_PER_DAY} outreach emails per 24 hours allowed.`
    };
  }

  return { allowed: true };
}

/**
 * Appends mandatory recruiter opt-out footer.
 */
function appendOptOutFooter(body: string): string {
  const footer = "\n\n---\nIf you prefer not to receive candidate inquiries from me, please reply with 'unsubscribe' and I will not contact you again.";
  if (body.includes("unsubscribe")) return body;
  return body + footer;
}

/**
 * Dispatches an approved recruiter outreach email using configured SMTP or API.
 * Never sends without explicit candidate approval.
 */
export async function dispatchRecruiterEmail(options: SendEmailOptions): Promise<EmailDispatchResult> {
  const nowIso = new Date().toISOString();

  // Guard 1: Strict candidate approval
  if (!options.userExplicitlyApproved) {
    return {
      success: false,
      status: "approval_required",
      timestamp: nowIso,
      message: "Outreach dispatch halted: Explicit candidate approval is strictly required before sending emails."
    };
  }

  // Guard 2: Duplicate prevention & rate limiting
  const guard = checkGuardrails(options.recipientAddress, options.opportunityId);
  if (!guard.allowed) {
    return {
      success: false,
      status: guard.status ?? "rate_limited",
      timestamp: nowIso,
      message: guard.reason ?? "Email send halted by safety safeguards."
    };
  }

  const finalBody = appendOptOutFooter(options.body);

  // Check SMTP Configuration
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT ?? 587);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const fromAddress = process.env.SMTP_FROM || options.candidateEmail || smtpUser;

  // Check Resend API Key alternative
  const resendApiKey = process.env.RESEND_API_KEY;

  if (smtpHost && smtpUser && smtpPass && fromAddress) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass
        }
      });

      const info = await transporter.sendMail({
        from: options.candidateName ? `"${options.candidateName}" <${fromAddress}>` : fromAddress,
        to: options.recipientAddress,
        replyTo: options.candidateEmail || fromAddress,
        subject: options.subject,
        text: finalBody
      });

      // Record in audit log
      sentHistory.push({
        recipient: options.recipientAddress,
        opportunityId: options.opportunityId,
        sentAt: Date.now()
      });

      return {
        success: true,
        status: "sent",
        messageId: info.messageId,
        timestamp: nowIso,
        message: `Email successfully dispatched to ${options.recipientAddress} via SMTP (Message-ID: ${info.messageId}).`
      };
    } catch (sendError) {
      return {
        success: false,
        status: "failed",
        timestamp: nowIso,
        message: `SMTP transmission failed: ${sendError instanceof Error ? sendError.message : String(sendError)}`,
        errorDetails: String(sendError)
      };
    }
  }

  if (resendApiKey && fromAddress) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: options.candidateName ? `${options.candidateName} <${fromAddress}>` : fromAddress,
          to: [options.recipientAddress],
          reply_to: options.candidateEmail || fromAddress,
          subject: options.subject,
          text: finalBody
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        return {
          success: false,
          status: "failed",
          timestamp: nowIso,
          message: `Resend API returned status ${res.status}: ${errText}`
        };
      }

      const resData = await res.json() as { id?: string };
      sentHistory.push({
        recipient: options.recipientAddress,
        opportunityId: options.opportunityId,
        sentAt: Date.now()
      });

      return {
        success: true,
        status: "sent",
        messageId: resData.id,
        timestamp: nowIso,
        message: `Email successfully dispatched to ${options.recipientAddress} via Resend (ID: ${resData.id}).`
      };
    } catch (resendError) {
      return {
        success: false,
        status: "failed",
        timestamp: nowIso,
        message: `Resend transmission failed: ${resendError instanceof Error ? resendError.message : String(resendError)}`
      };
    }
  }

  // If no email credentials configured:
  return {
    success: false,
    status: "unconfigured",
    timestamp: nowIso,
    message: "Email dispatch is unconfigured. To send live emails, configure SMTP credentials (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM) or RESEND_API_KEY in your environment."
  };
}

