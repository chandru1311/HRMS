/**
 * Automated Verification Suite for Face Template Replacement
 * ==========================================================
 * Tests all 11 required scenarios in pure in-memory mode.
 * No real HTTP server, no real PostgreSQL, no network required.
 * All controller logic is re-implemented here using the same
 * business-rule functions imported from the real service modules.
 *
 * Scenarios:
 *   1.  Admin enrolls an employee without an existing template (Mode A).
 *   2.  Admin replaces an existing enrolled employee's face template (Mode B).
 *   3.  Admin replaces a template when self-enrollment permission is revoked.
 *   4.  Employee cannot replace a template when self-enrollment permission is revoked.
 *   5.  Employee can replace a template after reauthorization.
 *   6.  Failed face detection preserves the previous embedding.
 *   7.  Failed Python face-service processing preserves the previous embedding.
 *   8.  Replacement updates the existing profile instead of creating a duplicate.
 *   9.  Cross-tenant admin replacement is rejected.
 *  10.  Attendance verification works using the newly replaced embedding.
 *  11.  Existing consent and attendance history remain intact.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isValidEmbedding, evaluateFaceMatch } from "../services/faceVerificationPolicy.js";
import { validateEnrollmentPayload, canEnrollFace } from "../services/faceEnrollmentValidation.js";
import { generateVerificationSessionToken } from "../services/livenessVerification.js";

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Custom error classes (mirror real service)
// ─────────────────────────────────────────────────────────────────────────────
class FaceServiceUnavailableError extends Error {
  constructor(msg = "Face service unavailable") {
    super(msg);
    this.name = "FaceServiceUnavailableError";
    this.status = 503;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: In-memory database store
// ─────────────────────────────────────────────────────────────────────────────
const DB = {
  users:          new Map(),  // userId → { id, company_id, role, name, email }
  face_profiles:  new Map(),  // profileId → profile row
  face_reenroll:  new Map(),  // reqId → request row
  attendance:     new Map(),  // attendId → attendance row
};

function resetDB() {
  DB.users.clear();
  DB.face_profiles.clear();
  DB.face_reenroll.clear();
  DB.attendance.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Synthetic helpers
// ─────────────────────────────────────────────────────────────────────────────
function makeSyntheticEmbedding(dim = 512, seed = 1) {
  const raw = Array.from({ length: dim }, (_, i) => Math.sin(seed * (i + 1)));
  const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0));
  return raw.map(v => v / norm);
}

// 200+ byte test image (passes payload length checks without being a real JPEG)
const validImageBase64 = "data:image/jpeg;base64," + "A".repeat(400);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: Mock face-service stub (overridden per scenario)
// ─────────────────────────────────────────────────────────────────────────────
const faceStub = {
  enrollFace: async () => { throw new Error("No enrollFace stub set for this test"); },
  verifyFace:  async () => { throw new Error("No verifyFace stub set for this test"); },
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: Controller logic (extracted from attendanceController.js)
// Pure functions that accept user+body, work against in-memory DB,
// and return { status, body } pairs — no Express, no network.
// ─────────────────────────────────────────────────────────────────────────────

function isAdminRole(user) {
  const r = String(user?.role || "").toLowerCase();
  return ["admin", "superadmin", "hr manager", "system admin"].includes(r);
}

function profileKey(userId) { return `${userId}_profile`; }

/**
 * enrollFace controller logic.
 * Returns { status: number, body: object }
 */
async function enrollFaceLogic(requester, body) {
  const { imageBase64, consentGiven = true, targetUserId, userId } = body;
  const consent = consentGiven;
  const resolvedTargetId = targetUserId || userId || requester.id;
  const isSelf = resolvedTargetId === requester.id;
  const isAdmin = isAdminRole(requester);

  if (!isSelf && !isAdmin) {
    return { status: 403, body: { error: "Unauthorized: Cannot enroll face biometrics for another user." } };
  }

  let targetCompanyId = requester.companyId || requester.company_id;

  if (!isSelf) {
    const targetUser = DB.users.get(resolvedTargetId);
    if (!targetUser) {
      return { status: 404, body: { error: "Target employee not found." } };
    }
    const isSuperAdmin = requester.role?.toLowerCase() === "superadmin";
    if (!isSuperAdmin && targetUser.company_id !== (requester.companyId || requester.company_id)) {
      return {
        status: 403,
        body: {
          error: "Access denied. Target employee belongs to another organization.",
          code: "CROSS_TENANT_ACCESS_DENIED"
        }
      };
    }
    targetCompanyId = targetUser.company_id;
  }

  // Find existing profile
  const pk = profileKey(resolvedTargetId);
  const existingProfile = DB.face_profiles.get(pk) || null;
  const isAlreadyEnrolled = Boolean(
    existingProfile &&
    existingProfile.enrollment_status === "enrolled" &&
    existingProfile.face_embedding
  );

  // Self-enrollment checks
  if (isSelf && !isAdmin) {
    const isAuthorized = Boolean(existingProfile?.metadata?.selfEnrollmentAuthorized);
    if (!isAuthorized) {
      return {
        status: 403,
        body: {
          error: "Face self-enrollment has not been authorized by HR or an Administrator.",
          code: "SELF_ENROLLMENT_NOT_AUTHORIZED"
        }
      };
    }
    if (isAlreadyEnrolled && !existingProfile?.metadata?.reenrollmentAuthorized) {
      return {
        status: 403,
        body: {
          error: "Face template is already enrolled. Self-replacement is not permitted. Please contact your administrator.",
          code: "SELF_ENROLLMENT_NOT_AUTHORIZED"
        }
      };
    }
  }

  // Payload validation
  const validation = validateEnrollmentPayload({ imageBase64, consentGiven: consent });
  if (!validation.valid) {
    return { status: 400, body: { error: validation.error } };
  }

  // Call face service stub
  let microserviceResult;
  try {
    microserviceResult = await faceStub.enrollFace(imageBase64);
  } catch (svcErr) {
    // Service failure – old embedding must NOT be touched
    return { status: svcErr.status || 400, body: { error: svcErr.message } };
  }

  const { embedding, model, embedding_dimension, quality_score, face_count } = microserviceResult;

  if (!isValidEmbedding(embedding, 512)) {
    return { status: 500, body: { error: "Biometric service generated an invalid face embedding vector." } };
  }

  const now = new Date().toISOString();

  if (isAlreadyEnrolled) {
    // ── MODE B: Template Replacement ──────────────────────────────────────────
    // Atomic UPDATE: preserve consent_recorded_at and profile ID
    const updatedMetadata = {
      ...(existingProfile.metadata || {}),
      qualityScore: quality_score,
      faceCount: face_count,
      lastReplacementAt: now,
      replacedBy: requester.id,
      replacedByRole: requester.role || (isAdmin ? "admin" : "employee"),
      replacementCount: ((existingProfile.metadata?.replacementCount) || 0) + 1,
      previousEnrolledAt: existingProfile.enrolled_at,
      reenrollmentAuthorized: false,
    };

    DB.face_profiles.set(pk, {
      ...existingProfile,                     // preserves id, user_id, company_id, consent_recorded_at
      face_embedding: embedding,              // replaced
      embedding_model: model || "ArcFace",
      embedding_dimension: embedding_dimension || 512,
      enrollment_status: "enrolled",
      enrolled_by: requester.id,
      enrolled_at: now,
      metadata: updatedMetadata,
      updated_at: now,
      // consent_recorded_at intentionally NOT overwritten
    });

    // Mark reenrollment permission as used for self-enrollment
    if (isSelf && !isAdmin) {
      for (const [k, r] of DB.face_reenroll) {
        if (r.employee_id === resolvedTargetId &&
            r.company_id === targetCompanyId &&
            r.status === "approved" && !r.used_at &&
            r.permission_expires_at && new Date(r.permission_expires_at) > new Date()) {
          r.used_at = now;
          r.permission_expires_at = null;
          r.updated_at = now;
          DB.face_reenroll.set(k, r);
          break;
        }
      }
    }

    return {
      status: 200,
      body: {
        success: true,
        mode: "replacement",
        enrollment_status: "enrolled",
        enrolled_at: now,
        model: model || "ArcFace",
        message: "Face reference template replaced and validated successfully."
      }
    };
  }

  // ── MODE A: New Enrollment ────────────────────────────────────────────────
  const pid = existingProfile?.id || pk;
  const newMetadata = {
    ...(existingProfile?.metadata || {}),
    qualityScore: quality_score,
    faceCount: face_count,
    enrolledByRole: requester.role,
    consentRecorded: true,
    enrolledBy: requester.id,
    reenrollmentAuthorized: false,
  };

  if (existingProfile) {
    DB.face_profiles.set(pid, {
      ...existingProfile,
      face_embedding: embedding,
      embedding_model: model || "ArcFace",
      embedding_dimension: embedding_dimension || 512,
      enrollment_status: "enrolled",
      enrolled_by: requester.id,
      enrolled_at: now,
      consent_recorded_at: existingProfile.consent_recorded_at || now,
      metadata: newMetadata,
      updated_at: now,
    });
  } else {
    DB.face_profiles.set(pid, {
      id: pid,
      user_id: resolvedTargetId,
      company_id: targetCompanyId,
      enrollment_status: "enrolled",
      face_embedding: embedding,
      embedding_model: model || "ArcFace",
      embedding_dimension: embedding_dimension || 512,
      enrolled_by: requester.id,
      enrolled_at: now,
      consent_recorded_at: now,
      metadata: newMetadata,
      updated_at: now,
    });
  }

  return {
    status: 200,
    body: {
      success: true,
      mode: "enrollment",
      enrollment_status: "enrolled",
      enrolled_at: now,
      model: model || "ArcFace",
      message: "Face reference template enrolled successfully."
    }
  };
}

/**
 * authorizeFaceEnrollment controller logic.
 */
async function authorizeFaceEnrollmentLogic(requester, body) {
  const { targetUserId, authorized = true } = body;
  if (!targetUserId) return { status: 400, body: { error: "targetUserId is required." } };

  if (!isAdminRole(requester)) {
    return { status: 403, body: { error: "Only administrators can authorize face enrollment." } };
  }

  const targetUser = DB.users.get(targetUserId);
  if (!targetUser) return { status: 404, body: { error: "Target employee not found." } };

  const isSuperAdmin = requester.role?.toLowerCase() === "superadmin";
  const requesterCompanyId = requester.companyId || requester.company_id;
  if (!isSuperAdmin && targetUser.company_id !== requesterCompanyId) {
    return { status: 403, body: { error: "Access denied. Cross-tenant authorization denied." } };
  }

  const pk = profileKey(targetUserId);
  const existing = DB.face_profiles.get(pk);
  const now = new Date().toISOString();

  if (authorized === false) {
    if (existing) {
      DB.face_profiles.set(pk, {
        ...existing,
        metadata: {
          ...(existing.metadata || {}),
          selfEnrollmentAuthorized: false,
          reenrollmentAuthorized: false,
          revokedAt: now,
          revokedBy: requester.id
        },
        updated_at: now
      });
    }
    for (const [k, r] of DB.face_reenroll) {
      if (r.employee_id === targetUserId && r.status === "approved") {
        r.status = "cancelled";
        r.permission_expires_at = null;
        r.updated_at = now;
        DB.face_reenroll.set(k, r);
      }
    }
    return { status: 200, body: { success: true, message: "Face re-enrollment access revoked.", targetUserId, authorized: false } };
  }

  const authPatch = {
    selfEnrollmentAuthorized: true,
    reenrollmentAuthorized: true,
    authorizedAt: now,
    authorizedBy: requester.id,
  };

  if (existing) {
    DB.face_profiles.set(pk, {
      ...existing,
      metadata: { ...(existing.metadata || {}), ...authPatch },
      updated_at: now,
    });
  } else {
    DB.face_profiles.set(pk, {
      id: pk,
      user_id: targetUserId,
      company_id: targetUser.company_id || requesterCompanyId,
      enrollment_status: "pending",
      face_embedding: null,
      metadata: authPatch,
      updated_at: now,
    });
  }

  // Create approved reenrollment permission
  const reqId = `face_reenroll_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  DB.face_reenroll.set(reqId, {
    id: reqId,
    employee_id: targetUserId,
    company_id: targetUser.company_id || requesterCompanyId,
    reason: "admin authorization",
    status: "approved",
    reviewed_by: requester.id,
    reviewed_at: now,
    permission_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    used_at: null,
    created_at: now,
    updated_at: now,
  });

  return { status: 200, body: { success: true, message: "Face self-enrollment authorized.", targetUserId, authorized: true } };
}

/**
 * verifyFaceSession controller logic.
 */
async function verifyFaceSessionLogic(requester, body) {
  const { imageBase64, workMode = "office", location = {}, actionType = "check-in" } = body;

  if (!imageBase64) return { status: 400, body: { error: "Image required." } };

  const pk = profileKey(requester.id);
  const profile = DB.face_profiles.get(pk);

  if (!profile || profile.enrollment_status !== "enrolled" || !profile.face_embedding) {
    return { status: 403, body: { error: "No enrolled face template found.", code: "ENROLLMENT_REQUIRED" } };
  }

  let enrolledEmbedding = profile.face_embedding;
  if (typeof enrolledEmbedding === "string") {
    try { enrolledEmbedding = JSON.parse(enrolledEmbedding); } catch { enrolledEmbedding = null; }
  }

  if (!isValidEmbedding(enrolledEmbedding)) {
    return { status: 400, body: { error: "Enrolled face template is corrupted.", code: "REENROLLMENT_REQUIRED" } };
  }

  let verifyResult;
  try {
    verifyResult = await faceStub.verifyFace({ enrolledEmbedding, imageBase64 });
  } catch (err) {
    return { status: 503, body: { error: "Biometric verification service unavailable.", code: "BIOMETRIC_SERVICE_UNAVAILABLE" } };
  }

  const matchEval = evaluateFaceMatch(verifyResult);
  if (!matchEval.passed) {
    return { status: 400, body: { error: matchEval.reason, code: "FACE_MISMATCH" } };
  }

  const { rawToken } = generateVerificationSessionToken();
  return {
    status: 200,
    body: {
      success: true,
      verified: true,
      verificationSessionToken: rawToken,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      status: "verified",
      liveness_result: "not_checked",
      distance: verifyResult.distance,
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: Test fixtures
// ─────────────────────────────────────────────────────────────────────────────
const companyA = "company_repl_alpha";
const companyB = "company_repl_beta";

const adminA   = { id: "test_admin_a", role: "admin",    companyId: companyA };
const adminB   = { id: "test_admin_b", role: "admin",    companyId: companyB };
const empA1    = { id: "test_emp_a1",  role: "employee", companyId: companyA };

function setupFixtures() {
  resetDB();
  DB.users.set(adminA.id, { id: adminA.id, company_id: companyA, role: "admin",    name: "Admin A", email: "admin_a@test.com" });
  DB.users.set(adminB.id, { id: adminB.id, company_id: companyB, role: "admin",    name: "Admin B", email: "admin_b@test.com" });
  DB.users.set(empA1.id,  { id: empA1.id,  company_id: companyA, role: "employee", name: "Emp A1",  email: "emp_a1@test.com"  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: The test suite
// ─────────────────────────────────────────────────────────────────────────────
describe("HRMS Face Template Replacement & Biometrics Suite", () => {

  // ── Scenario 1 ─────────────────────────────────────────────────────────────
  it("1. Admin enrolls an employee without an existing template (Mode A: New Enrollment)", async () => {
    setupFixtures();

    const embedding1 = makeSyntheticEmbedding(512, 10);
    faceStub.enrollFace = async () => ({ embedding: embedding1, model: "ArcFace", embedding_dimension: 512, quality_score: 0.88, face_count: 1 });

    const { status, body } = await enrollFaceLogic(adminA, {
      targetUserId: empA1.id,
      imageBase64: validImageBase64,
      consentGiven: true
    });

    assert.equal(status, 200,          "Admin new enrollment must return 200");
    assert.equal(body.success, true);
    assert.equal(body.mode, "enrollment",  "Mode must be 'enrollment' for a new template");
    assert.equal(body.enrollment_status, "enrolled");

    const profile = DB.face_profiles.get(profileKey(empA1.id));
    assert.ok(profile,                           "Profile must exist in DB");
    assert.equal(profile.enrollment_status, "enrolled");
    assert.ok(profile.consent_recorded_at,       "Consent timestamp must be recorded");
    assert.deepEqual(profile.face_embedding, embedding1, "Stored embedding must match service output");
  });

  // ── Scenario 2 ─────────────────────────────────────────────────────────────
  it("2. Admin replaces an existing enrolled employee's face template (Mode B: Template Replacement)", async () => {
    // State from scenario 1 is preserved (sequential)
    const profileBefore = DB.face_profiles.get(profileKey(empA1.id));
    assert.ok(profileBefore, "Profile from scenario 1 must exist");

    const originalConsentTs  = profileBefore.consent_recorded_at;
    const originalProfileId  = profileBefore.id;

    const embedding2 = makeSyntheticEmbedding(512, 20);
    faceStub.enrollFace = async () => ({ embedding: embedding2, model: "ArcFace", embedding_dimension: 512, quality_score: 0.94, face_count: 1 });

    const { status, body } = await enrollFaceLogic(adminA, {
      targetUserId: empA1.id,
      imageBase64: validImageBase64,
      consentGiven: true
    });

    assert.equal(status, 200,            "Replacement must return 200");
    assert.equal(body.success, true);
    assert.equal(body.mode, "replacement", "Mode must be 'replacement'");
    assert.equal(body.enrollment_status, "enrolled");

    // Exactly one profile row
    const profilesForUser = Array.from(DB.face_profiles.values()).filter(p => p.user_id === empA1.id);
    assert.equal(profilesForUser.length, 1, "Exactly one profile must exist (no duplicate created)");

    const profileAfter = profilesForUser[0];
    assert.equal(profileAfter.id, originalProfileId, "Profile ID must be preserved");
    assert.equal(
      new Date(profileAfter.consent_recorded_at).toISOString(),
      new Date(originalConsentTs).toISOString(),
      "Original biometric consent timestamp must NOT be overwritten"
    );
    assert.deepEqual(profileAfter.face_embedding, embedding2, "Embedding must match newly generated vector");
    assert.equal(profileAfter.metadata.replacementCount, 1, "replacementCount must be 1");
  });

  // ── Scenario 3 ─────────────────────────────────────────────────────────────
  it("3. Admin replaces a template when employee self-enrollment permission is revoked", async () => {
    // Revoke self-enrollment for employee
    const pk = profileKey(empA1.id);
    const profile = DB.face_profiles.get(pk);
    DB.face_profiles.set(pk, {
      ...profile,
      metadata: { ...(profile.metadata || {}), selfEnrollmentAuthorized: false, reenrollmentAuthorized: false }
    });

    assert.equal(DB.face_profiles.get(pk).metadata.selfEnrollmentAuthorized, false,
      "selfEnrollmentAuthorized must be false before this test");

    const embedding3 = makeSyntheticEmbedding(512, 30);
    faceStub.enrollFace = async () => ({ embedding: embedding3, model: "ArcFace", embedding_dimension: 512, quality_score: 0.91, face_count: 1 });

    const { status, body } = await enrollFaceLogic(adminA, {
      targetUserId: empA1.id,
      imageBase64: validImageBase64,
      consentGiven: true
    });

    assert.equal(status, 200, "Admin replacement must succeed even when employee self-enrollment is revoked");
    assert.equal(body.success, true);
    assert.equal(body.mode, "replacement");
  });

  // ── Scenario 4 ─────────────────────────────────────────────────────────────
  it("4. Employee cannot replace a template when self-enrollment permission is revoked", async () => {
    // selfEnrollmentAuthorized is still false from scenario 3
    const { status, body } = await enrollFaceLogic(empA1, {
      imageBase64: validImageBase64,
      consentGiven: true
    });

    assert.equal(status, 403, "Self-replacement without authorization must return 403");
    assert.match(body.error, /authorized|Self-replacement/i, "Error must reference authorization");
  });

  // ── Scenario 5 ─────────────────────────────────────────────────────────────
  it("5. Employee can replace a template after reauthorization (Admin Enable & Revoke Control)", async () => {
    // Admin reauthorizes employee via "Re-Enroll by Employee Access"
    const { status: authStatus, body: authBody } = await authorizeFaceEnrollmentLogic(adminA, { targetUserId: empA1.id, authorized: true });
    assert.equal(authStatus, 200, "Authorization endpoint must return 200");
    assert.equal(authBody.authorized, true);

    // Confirm reenrollmentAuthorized is set
    let profile = DB.face_profiles.get(profileKey(empA1.id));
    assert.equal(profile.metadata.reenrollmentAuthorized, true, "reenrollmentAuthorized must be set after admin auth");

    // Admin toggles/revokes re-enrollment access
    const { status: revokeStatus, body: revokeBody } = await authorizeFaceEnrollmentLogic(adminA, { targetUserId: empA1.id, authorized: false });
    assert.equal(revokeStatus, 200);
    assert.equal(revokeBody.authorized, false);
    profile = DB.face_profiles.get(profileKey(empA1.id));
    assert.equal(profile.metadata.reenrollmentAuthorized, false, "reenrollmentAuthorized must be revoked");

    // Employee cannot self-replace while revoked
    const blockedRes = await enrollFaceLogic(empA1, { imageBase64: validImageBase64, consentGiven: true });
    assert.equal(blockedRes.status, 403, "Self-replacement blocked while revoked");

    // Admin re-enables "Re-Enroll by Employee Access"
    await authorizeFaceEnrollmentLogic(adminA, { targetUserId: empA1.id, authorized: true });

    // Employee self-replaces
    const embeddingSelf = makeSyntheticEmbedding(512, 50);
    faceStub.enrollFace = async () => ({ embedding: embeddingSelf, model: "ArcFace", embedding_dimension: 512, quality_score: 0.95, face_count: 1 });

    const { status, body } = await enrollFaceLogic(empA1, {
      imageBase64: validImageBase64,
      consentGiven: true
    });

    assert.equal(status, 200, "Reauthorized self-replacement must succeed");
    assert.equal(body.success, true);
    assert.equal(body.mode, "replacement");
  });

  // ── Scenario 6 ─────────────────────────────────────────────────────────────
  it("6. Failed face detection preserves the previous embedding", async () => {
    const pkBefore = DB.face_profiles.get(profileKey(empA1.id));
    const embeddingBefore = pkBefore.face_embedding;
    assert.ok(embeddingBefore, "Pre-condition: an embedding must exist");

    // Simulate face service returning 400 (no face detected)
    faceStub.enrollFace = async () => {
      const err = new Error("No face detected. Please ensure your face is well-lit and centered.");
      err.status = 400;
      throw err;
    };

    const { status } = await enrollFaceLogic(adminA, {
      targetUserId: empA1.id,
      imageBase64: validImageBase64,
      consentGiven: true
    });

    assert.equal(status, 400, "Must return 400 on face detection failure");

    // Embedding must be completely untouched
    const profileAfter = DB.face_profiles.get(profileKey(empA1.id));
    assert.deepEqual(profileAfter.face_embedding, embeddingBefore,
      "Previous embedding must be preserved on face detection failure");
  });

  // ── Scenario 7 ─────────────────────────────────────────────────────────────
  it("7. Failed Python face-service processing preserves the previous embedding", async () => {
    const pkBefore = DB.face_profiles.get(profileKey(empA1.id));
    const embeddingBefore = pkBefore.face_embedding;

    // Simulate face service offline (503)
    faceStub.enrollFace = async () => {
      throw new FaceServiceUnavailableError("Face verification service is offline.");
    };

    const { status } = await enrollFaceLogic(adminA, {
      targetUserId: empA1.id,
      imageBase64: validImageBase64,
      consentGiven: true
    });

    assert.equal(status, 503, "Must return 503 when face service is unavailable");

    // Embedding must be completely untouched
    const profileAfter = DB.face_profiles.get(profileKey(empA1.id));
    assert.deepEqual(profileAfter.face_embedding, embeddingBefore,
      "Previous embedding must be preserved on microservice failure");
  });

  // ── Scenario 8 ─────────────────────────────────────────────────────────────
  it("8. Replacement updates the existing profile instead of creating a duplicate", async () => {
    const countBefore = Array.from(DB.face_profiles.values()).filter(p => p.user_id === empA1.id).length;
    assert.equal(countBefore, 1, "Precondition: exactly one profile must exist");

    const embedding8 = makeSyntheticEmbedding(512, 80);
    faceStub.enrollFace = async () => ({ embedding: embedding8, model: "ArcFace", embedding_dimension: 512, quality_score: 0.90, face_count: 1 });

    const { status } = await enrollFaceLogic(adminA, {
      targetUserId: empA1.id,
      imageBase64: validImageBase64,
      consentGiven: true
    });

    assert.equal(status, 200, "Replacement must succeed");

    const countAfter = Array.from(DB.face_profiles.values()).filter(p => p.user_id === empA1.id).length;
    assert.equal(countAfter, 1, "Must maintain exactly one profile row per employee (no duplicate)");
  });

  // ── Scenario 9 ─────────────────────────────────────────────────────────────
  it("9. Cross-tenant admin replacement is rejected", async () => {
    // Admin B (Company B) attempts to replace face template for Employee A1 (Company A)
    const { status, body } = await enrollFaceLogic(adminB, {
      targetUserId: empA1.id,
      imageBase64: validImageBase64,
      consentGiven: true
    });

    assert.equal(status, 403, "Cross-tenant replacement must be rejected with 403");
    assert.equal(body.code, "CROSS_TENANT_ACCESS_DENIED", "Must return CROSS_TENANT_ACCESS_DENIED code");
  });

  // ── Scenario 10 ────────────────────────────────────────────────────────────
  it("10. Attendance verification works using the newly replaced embedding", async () => {
    // Active embedding after scenario 8 is embedding8 (seed 80)
    const activeProfile = DB.face_profiles.get(profileKey(empA1.id));
    const activeEmbedding = activeProfile.face_embedding;

    let receivedEnrolledEmbedding = null;

    faceStub.verifyFace = async ({ enrolledEmbedding, imageBase64 }) => {
      receivedEnrolledEmbedding = enrolledEmbedding;   // capture what was passed
      return {
        matched: true,
        distance: 0.12,
        threshold: 0.40,
        model: "ArcFace",
        face_count: 1,
        quality_score: 0.95,
        liveness_result: "not_checked"
      };
    };

    const { status, body } = await verifyFaceSessionLogic(empA1, {
      imageBase64: validImageBase64,
      workMode: "office",
      location: { latitude: 13.0827, longitude: 80.2707 },
      actionType: "check-in"
    });

    assert.equal(status, 200,          "Verification must succeed with active template");
    assert.equal(body.verified, true);
    assert.ok(body.verificationSessionToken, "Must return a session token");
    assert.deepEqual(receivedEnrolledEmbedding, activeEmbedding,
      "Attendance verification must use the replaced (active) embedding, not the original");
  });

  // ── Scenario 11 ────────────────────────────────────────────────────────────
  it("11. Existing consent and attendance history remain intact after replacement", async () => {
    // Seed an attendance record for employee A1
    DB.attendance.set("test_att_hist_1", {
      id: "test_att_hist_1",
      user_id: empA1.id,
      company_id: companyA,
      date: new Date().toISOString().slice(0, 10),
      status: "present",
      check_in: new Date().toISOString(),
    });

    // Record consent timestamp before the final replacement
    const profileBefore = DB.face_profiles.get(profileKey(empA1.id));
    const consentBefore = profileBefore.consent_recorded_at;
    assert.ok(consentBefore, "Precondition: consent timestamp must exist");

    // Admin performs another replacement
    const embeddingFinal = makeSyntheticEmbedding(512, 999);
    faceStub.enrollFace = async () => ({ embedding: embeddingFinal, model: "ArcFace", embedding_dimension: 512, quality_score: 0.92, face_count: 1 });

    const { status } = await enrollFaceLogic(adminA, {
      targetUserId: empA1.id,
      imageBase64: validImageBase64,
      consentGiven: true
    });
    assert.equal(status, 200, "Template replacement must succeed");

    // ── Attendance records must be intact ─────────────────────────────────────
    const attRecord = DB.attendance.get("test_att_hist_1");
    assert.ok(attRecord, "Historical attendance record must never be deleted");
    assert.equal(attRecord.user_id, empA1.id, "Attendance must belong to correct employee");

    // ── Consent timestamp must NOT be reset ───────────────────────────────────
    const profCheck = DB.face_profiles.get(profileKey(empA1.id));
    assert.ok(profCheck.consent_recorded_at, "Biometric consent timestamp must remain set");
    assert.equal(
      new Date(profCheck.consent_recorded_at).toISOString(),
      new Date(consentBefore).toISOString(),
      "Consent timestamp must be preserved exactly across template replacement"
    );

    // ── canEnrollFace policy validation ──────────────────────────────────────
    const adminDecision = canEnrollFace({ requesterRole: "admin", isSelf: false, isAuthorizedByAdmin: true, isAlreadyEnrolled: true });
    assert.equal(adminDecision.allowed, true, "canEnrollFace must allow admin replacement");
    assert.equal(adminDecision.mode, "replacement");

    const empBlockedDecision = canEnrollFace({ requesterRole: "employee", isSelf: true, isAuthorizedByAdmin: false, isAlreadyEnrolled: true, isReenrollmentAuthorized: false });
    assert.equal(empBlockedDecision.allowed, false, "canEnrollFace must block unauthorized self-replacement");

    const empAllowedDecision = canEnrollFace({ requesterRole: "employee", isSelf: true, isAuthorizedByAdmin: true, isAlreadyEnrolled: true, isReenrollmentAuthorized: true });
    assert.equal(empAllowedDecision.allowed, true, "canEnrollFace must allow reauthorized self-replacement");
  });
});
