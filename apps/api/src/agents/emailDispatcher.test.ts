import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatchRecruiterEmail } from "./emailDispatcher.js";

test("dispatchRecruiterEmail enforces strict explicit candidate approval", async () => {
  const result = await dispatchRecruiterEmail({
    draftId: "draft-1",
    recipientAddress: "recruiter@example.com",
    subject: "Interest in Backend Engineer role",
    body: "Hello, I am interested in this role.",
    userExplicitlyApproved: false
  });

  assert.equal(result.success, false);
  assert.equal(result.status, "approval_required");
  assert.match(result.message, /Explicit candidate approval is strictly required/i);
});

test("dispatchRecruiterEmail returns clear unconfigured status when SMTP credentials are not present", async () => {
  // Clear any SMTP env vars for test isolation
  const prevHost = process.env.SMTP_HOST;
  const prevKey = process.env.RESEND_API_KEY;
  delete process.env.SMTP_HOST;
  delete process.env.RESEND_API_KEY;

  try {
    const result = await dispatchRecruiterEmail({
      draftId: "draft-2",
      recipientAddress: "recruiter@example.com",
      subject: "Interest in Backend Engineer role",
      body: "Hello, I am interested in this role.",
      userExplicitlyApproved: true
    });

    assert.equal(result.success, false);
    assert.equal(result.status, "unconfigured");
    assert.match(result.message, /configure SMTP credentials/i);
  } finally {
    if (prevHost) process.env.SMTP_HOST = prevHost;
    if (prevKey) process.env.RESEND_API_KEY = prevKey;
  }
});

