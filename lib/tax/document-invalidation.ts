import type { Prisma } from "@prisma/client";

/**
 * A newly saved/approved tax source makes prior calculations, packets and
 * in-flight portal work stale. Call inside the same database transaction as
 * the document write so an older approval cannot remain active by accident.
 */
export async function invalidateFilingForDocumentChange(
  tx: Pick<
    Prisma.TransactionClient,
    "filingDraft" | "filingPacket" | "fbrConnection" | "localAgentJob"
  >,
  filingDraftId: string,
  userId: string,
) {
  await tx.filingDraft.update({
    where: { id: filingDraftId },
    data: {
      status: "IN_PROGRESS",
      taxCalculationStatus: "NOT_CALCULATED",
      taxableIncome: null,
      taxPayable: null,
      refundDue: null,
      taxCalculationRevision: null,
      packetApprovalConfirmed: false,
      packetApprovalAt: null,
      packetApprovalByUserId: null,
    },
  });
  await tx.filingPacket.updateMany({
    where: { filingDraftId, userId, status: { not: "SUPERSEDED" } },
    data: { status: "SUPERSEDED", approvalStatus: "SUPERSEDED" },
  });
  await tx.fbrConnection.updateMany({
    where: { filingDraftId, userId },
    data: {
      status: "NOT_STARTED",
      agentId: null,
      message: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      lastHeartbeat: null,
    },
  });

  // Superseding a packet alone does not stop a worker that has already fetched
  // it; the agent checks job status before each portal step.
  await tx.localAgentJob.updateMany({
    where: {
      filingDraftId,
      userId,
      status: {
        in: [
          "created",
          "offered_to_device",
          "accepted_by_device",
          "running",
          "awaiting_user_action",
        ],
      },
    },
    data: { status: "cancelled", completedAt: new Date() },
  });
}
