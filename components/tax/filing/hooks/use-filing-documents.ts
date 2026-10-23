import { PENSION_LABELS, pensionFieldKey, type PensionReviewDecisionKey } from "@/lib/tax/pension-statement-fields";
import { isBusinessPurchaseBasisField } from "@/lib/tax/business-schedule-fields";
import { useEffect, useRef, useState } from "react";
import {
  describeCnicProfilePlan,
  formatCnicInput,
  normalizeIdentityName,
} from "@/lib/tax/cnic-profile";

import { salaryCertificateEmployerSignature } from "@/lib/tax/salary-certificate-fields";
import { uploadFilingDocumentAction } from "@/app/actions/documents";
import {
  approveAndMapExtractedDocumentAction,
  recoverBusinessPurchaseBasisAction,
  extractDocumentWithGeminiAction,
  getDocumentExtractionAction,
  getFilingDocumentsAction,
  saveBankStatementIbanAction,
  saveSalaryCertificateEmployersAction,
  updateDocumentExtractionAction,
} from "@/app/actions/extraction";
import { getFilingSummaryAction } from "@/app/actions/filing-summary";
import { isDocumentExtractionLeaseStale } from "@/lib/tax/document-extraction-state";
import type { FilingSummary } from "@/components/tax/filing/config/filing-wizard-config";
import type {
  ExtractedPayload,
  ExtractedTransaction,
  FilingDocumentRecord,
} from "@/components/tax/filing/wizard-documents-step";
import { isBankProfitCertificate } from "@/lib/tax/bank-profit-document-slot";

type ResetDownstreamSteps = (
  resetStep: number,
  preserveReconciliation?: boolean,
) => void;

type UseFilingDocumentsInput = {
  draftId: string | null;
  step: number;
  resetDownstreamSteps: ResetDownstreamSteps;
  setFilingSummary: (summary: FilingSummary) => void;
  /** Called when a mapped statement changed a bank account (its IBAN). */
  onBankAccountsChanged?: () => void;
};

export function useFilingDocuments({
  draftId,
  step,
  resetDownstreamSteps,
  setFilingSummary,
  onBankAccountsChanged,
}: UseFilingDocumentsInput) {
  const [uploadedDocuments, setUploadedDocuments] = useState<
    Record<string, string>
  >({});
  const [documentRecords, setDocumentRecords] = useState<
    Record<string, FilingDocumentRecord>
  >({});
  const [extractedByDocumentId, setExtractedByDocumentId] = useState<
    Record<string, ExtractedPayload>
  >({});
  // The employer fields as last saved, per document id. Employer names stay
  // editable after mapping; this tells whether the form still differs from
  // what is saved (the Save employer button and the Continue gate use it).
  const [savedEmployerSignatures, setSavedEmployerSignatures] = useState<
    Record<string, string>
  >({});
  const [extractingDocumentId, setExtractingDocumentId] = useState<
    string | null
  >(null);
  const [reviewingDocumentId, setReviewingDocumentId] = useState<string | null>(
    null,
  );
  const [savingDocumentReviewId, setSavingDocumentReviewId] = useState<
    string | null
  >(null);
  const [mappingDocumentId, setMappingDocumentId] = useState<string | null>(
    null,
  );
  const [selectedDocumentFiles, setSelectedDocumentFiles] = useState<
    Record<string, File>
  >({});
  const [uploadingDocumentType, setUploadingDocumentType] = useState<
    string | null
  >(null);
  const [documentUploadError, setDocumentUploadError] = useState<string | null>(
    null,
  );
  // What an approved CNIC actually changed on the profile. Not an error: when a
  // field is deliberately left alone (a name the human already typed) the operator
  // needs to know that, or the upload looks like it did nothing.
  const [profileSyncNote, setProfileSyncNote] = useState<string | null>(null);
  const uploadFileInputsRef = useRef<Record<string, HTMLInputElement | null>>(
    {},
  );
  const recoveringDocumentIds = useRef(new Set<string>());
  const latestActions = useRef({
    resetDownstreamSteps,
    setFilingSummary,
    step,
  });
  latestActions.current = { resetDownstreamSteps, setFilingSummary, step };

  // Restore saved review/mapping payloads on refresh, not just the status badge.
  // The extractedData remains on the owned Document row; this only hydrates the
  // client review panel and never starts another extraction request.
  // The first time a mapped salary certificate's fields are available they ARE
  // the saved values, so that is the baseline later edits are compared with.
  useEffect(() => {
    const salary = documentRecords.salary_certificate;
    if (!salary || salary.extractionStatus !== "MAPPED") return;
    const payload = extractedByDocumentId[salary.id];
    if (!payload?.fields || salary.id in savedEmployerSignatures) return;
    setSavedEmployerSignatures((previous) => ({
      ...previous,
      [salary.id]: salaryCertificateEmployerSignature(payload.fields),
    }));
  }, [documentRecords, extractedByDocumentId, savedEmployerSignatures]);

  useEffect(() => {
    for (const record of Object.values(documentRecords)) {
      if (
        !["COMPLETED", "MAPPED", "FAILED"].includes(record.extractionStatus) ||
        extractedByDocumentId[record.id] ||
        recoveringDocumentIds.current.has(record.id)
      ) {
        continue;
      }

      recoveringDocumentIds.current.add(record.id);
      void getDocumentExtractionAction(record.id)
        .then((result) => {
          if (!result.success || !result.extraction) return;
          setExtractedByDocumentId((previous) => ({
            ...previous,
            [record.id]: (result.extraction ?? {
              fields: [],
              notes: [],
            }) as ExtractedPayload,
          }));
        })
        .catch(() => {
          // The status remains available; the existing Review button can retry.
        })
        .finally(() => recoveringDocumentIds.current.delete(record.id));
    }
  }, [documentRecords, extractedByDocumentId]);

  useEffect(() => {
    if (!draftId) return;
    const processingDocuments = Object.entries(documentRecords).filter(
      ([, document]) =>
        document.extractionStatus === "PROCESSING" &&
        !isDocumentExtractionLeaseStale(
          document.extractionStatus,
          document.extractionStartedAt,
        ),
    );
    if (processingDocuments.length === 0) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      await Promise.all(
        processingDocuments.map(async ([documentType, record]) => {
          let result: Awaited<ReturnType<typeof getDocumentExtractionAction>>;
          try {
            result = await getDocumentExtractionAction(record.id);
          } catch {
            return;
          }
          if (cancelled || !result.success || result.status === "PROCESSING") {
            return;
          }

          const status = result.status ?? "FAILED";
          setDocumentRecords((previous) => {
            if (previous[documentType]?.id !== record.id) return previous;
            return {
              ...previous,
              [documentType]: {
                ...previous[documentType],
                extractionStatus: status,
                extractionStartedAt: result.extractionStartedAt ?? null,
                extractionError: result.extractionError ?? null,
                extractedAt:
                  status === "COMPLETED" || status === "MAPPED"
                    ? new Date().toISOString()
                    : previous[documentType].extractedAt,
              },
            };
          });

          if (
            (status === "COMPLETED" || status === "MAPPED") &&
            result.extraction
          ) {
            if (status === "COMPLETED") {
              latestActions.current.resetDownstreamSteps(
                latestActions.current.step,
              );
            }
            setExtractedByDocumentId((previous) => ({
              ...previous,
              [record.id]: result.extraction as ExtractedPayload,
            }));
            if (draftId) {
              const refreshedSummary = await getFilingSummaryAction(draftId);
              if (refreshedSummary.success) {
                latestActions.current.setFilingSummary(
                  refreshedSummary.summary as FilingSummary,
                );
              }
            }
          } else if (status === "FAILED") {
            if (result.extraction) {
              setExtractedByDocumentId((previous) => ({
                ...previous,
                [record.id]: result.extraction as ExtractedPayload,
              }));
            }
            setDocumentUploadError(
              result.extractionError ??
                "Document extraction failed. You can retry it.",
            );
          }
        }),
      );

      if (!cancelled) timer = setTimeout(poll, 2500);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [draftId, documentRecords]);

  function triggerDocumentUpload(documentType: string) {
    uploadFileInputsRef.current[documentType]?.click();
  }

  async function handleDocumentFileSelected(
    documentType: string,
    fileList: FileList | null,
  ) {
    const file = fileList?.[0];
    if (!file) return;

    setDocumentUploadError(null);
    setProfileSyncNote(null);
    setUploadedDocuments((prev) => ({ ...prev, [documentType]: file.name }));
    setSelectedDocumentFiles((prev) => ({ ...prev, [documentType]: file }));

    if (!draftId) return;

    setUploadingDocumentType(documentType);
    const uploadData = new FormData();
    uploadData.set("draftId", draftId);
    uploadData.set("documentType", documentType);
    uploadData.set("file", file);

    const result = await uploadFilingDocumentAction(uploadData);
    setUploadingDocumentType(null);
    setSelectedDocumentFiles((previous) => {
      const next = { ...previous };
      delete next[documentType];
      return next;
    });

    if (result.success) {
      setDocumentRecords((previous) => ({
        ...previous,
        [documentType]: {
          id: result.document.id,
          fileName: result.document.fileName,
          extractionStatus: result.document.extractionStatus,
          extractionProvider: null,
          extractionStartedAt: null,
          extractionError: null,
          extractedAt: null,
        },
      }));
      resetDownstreamSteps(step);
      return;
    }

    setDocumentUploadError(result.error ?? "Failed to upload document");
    setUploadedDocuments((prev) => {
      const next = { ...prev };
      delete next[documentType];
      return next;
    });
  }

  async function handleExtractDocument(documentType: string) {
    const record = documentRecords[documentType];
    if (!record) return;

    setExtractingDocumentId(record.id);
    setDocumentUploadError(null);
    setProfileSyncNote(null);
    const result = await extractDocumentWithGeminiAction(record.id);
    setExtractingDocumentId(null);

    if (!result.success) {
      const code = "code" in result ? result.code : undefined;
      if (code === "ALREADY_PROCESSING") {
        setDocumentRecords((previous) => ({
          ...previous,
          [documentType]: {
            ...record,
            extractionStatus: "PROCESSING",
            extractionStartedAt:
              "extractionStartedAt" in result
                ? (result.extractionStartedAt ??
                  record.extractionStartedAt ??
                  null)
                : (record.extractionStartedAt ?? null),
            extractionError: null,
          },
        }));
        // The status poll below will bring the saved extraction into the form.
        return;
      }

      if (code === "ALREADY_MAPPED" || code === "ALREADY_EXTRACTED") {
        const refreshed = await getDocumentExtractionAction(record.id);
        if (refreshed.success) {
          const status =
            refreshed.status ??
            (code === "ALREADY_MAPPED" ? "MAPPED" : "COMPLETED");
          setDocumentRecords((previous) => ({
            ...previous,
            [documentType]: {
              ...record,
              extractionStatus: status,
              extractionStartedAt: refreshed.extractionStartedAt ?? null,
              extractionError: refreshed.extractionError ?? null,
            },
          }));
          if (refreshed.extraction) {
            setExtractedByDocumentId((previous) => ({
              ...previous,
              [record.id]: refreshed.extraction as ExtractedPayload,
            }));
          }
          return;
        }
      }

      setDocumentUploadError(
        "error" in result ? result.error : "Document extraction failed",
      );
      // Do not guess the database state from a network/rate-limit error.
      const refreshed = await getDocumentExtractionAction(record.id);
      if (refreshed.success) {
        setDocumentRecords((previous) => ({
          ...previous,
          [documentType]: {
            ...record,
            extractionStatus: refreshed.status ?? record.extractionStatus,
            extractionStartedAt: refreshed.extractionStartedAt ?? null,
            extractionError: refreshed.extractionError ?? null,
          },
        }));
        if (refreshed.extraction) {
          setExtractedByDocumentId((previous) => ({
            ...previous,
            [record.id]: refreshed.extraction as ExtractedPayload,
          }));
        }
      }
      return;
    }

    setDocumentRecords((previous) => ({
      ...previous,
      [documentType]: {
        ...record,
        extractionStatus:
          "status" in result && result.status ? result.status : "COMPLETED",
        extractionStartedAt: null,
        extractionError: null,
        extractionProvider: result.provider ?? "gemini",
        extractedAt: new Date().toISOString(),
      },
    }));
    setExtractedByDocumentId((previous) => ({
      ...previous,
      [record.id]: (result.extracted ?? {
        fields: [],
        notes: [],
      }) as ExtractedPayload,
    }));
    resetDownstreamSteps(step);

    if (draftId) {
      const refreshedSummary = await getFilingSummaryAction(draftId);
      if (refreshedSummary.success) {
        setFilingSummary(refreshedSummary.summary as FilingSummary);
      }
    }
  }

  async function handleReviewDocument(documentType: string) {
    const record = documentRecords[documentType];
    if (!record || extractedByDocumentId[record.id]) return;

    setReviewingDocumentId(record.id);
    setDocumentUploadError(null);
    setProfileSyncNote(null);
    const result = await getDocumentExtractionAction(record.id);
    setReviewingDocumentId(null);

    if (!result.success) {
      setDocumentUploadError(result.error ?? "Failed to load extracted data");
      return;
    }

    setExtractedByDocumentId((previous) => ({
      ...previous,
      [record.id]: (result.extraction ?? {
        fields: [],
        notes: [],
      }) as ExtractedPayload,
    }));
  }

  function handleExtractedFieldChange(
    documentType: string,
    fieldIndex: number,
    value: string,
  ) {
    const record = documentRecords[documentType];
    if (!record) return;
    if (
      (documentType === "pension_statement" || isBankProfitCertificate(documentType)) &&
      record.extractionStatus === "MAPPED"
    ) {
      setDocumentRecords((previous) => ({
        ...previous,
        [documentType]: { ...record, extractionStatus: "COMPLETED" },
      }));
      setProfileSyncNote(
        isBankProfitCertificate(documentType)
          ? "Unsaved bank-profit certificate changes: Save & Approve Map again before continuing. The prior approved projection is not silently overwritten."
          : "Unsaved pension changes: Save & Approve Map again before continuing. The previously approved source is not silently overwritten.",
      );
      resetDownstreamSteps(step, true);
    }
    if (
      documentType === "business_books" &&
      record.extractionStatus === "MAPPED" &&
      isBusinessPurchaseBasisField(
        extractedByDocumentId[record.id]?.fields?.[fieldIndex]?.label,
      )
    ) {
      // Unsaved basis changes must not look like approved mapped facts locally.
      setDocumentRecords((previous) => ({
        ...previous,
        [documentType]: { ...record, extractionStatus: "COMPLETED" },
      }));
      resetDownstreamSteps(step);
    }

    setExtractedByDocumentId((previous) => {
      const payload = previous[record.id];
      if (!payload?.fields) return previous;
      const field = payload.fields[fieldIndex];
      if (!field) return previous;

      const label = field.label.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      const nextValue = [
        "cnic_number",
        "cnic",
        "identity_number",
        "taxpayer_cnic",
      ].includes(label)
        ? formatCnicInput(value)
        : ["name", "full_name", "taxpayer_name"].includes(label)
          ? normalizeIdentityName(value)
          : /(^|_)iban(_|$)/.test(label)
            ? value
                .toUpperCase()
                .replace(/[\s-]+/g, "")
                .slice(0, 24)
            : value;
      const fields = payload.fields.map((current, index) =>
        index === fieldIndex
          ? {
              ...current,
              value: nextValue,
              ...(documentType === "pension_statement"
                ? {
                    reviewSuggestion: false,
                    sourceEvidence: undefined,
                    confidence: 0,
                  }
                : {}),
            }
          : current,
      );
      const nextPayload: ExtractedPayload = { ...payload, fields };
      if (isBankProfitCertificate(documentType)) {
        delete nextPayload.approvedBankProfitCertificate;
      }
      return { ...previous, [record.id]: nextPayload };
    });
  }

  function handlePensionReviewFieldChange(
    documentType: string,
    key: PensionReviewDecisionKey,
    value: string,
  ) {
    if (documentType !== "pension_statement") return;
    const record = documentRecords[documentType];
    if (!record) return;
    const fields = extractedByDocumentId[record.id]?.fields ?? [];
    const index = fields.findIndex((field) => pensionFieldKey(field.label) === key);
    if (index >= 0) {
      handleExtractedFieldChange(documentType, index, value);
      return;
    }
    if (record.extractionStatus === "MAPPED") {
      setDocumentRecords(previous => ({ ...previous, [documentType]: { ...record, extractionStatus: "COMPLETED" } }));
      setProfileSyncNote("Unsaved pension changes: Save & Approve Map again before continuing.");
      resetDownstreamSteps(step, true);
    }
    setExtractedByDocumentId(previous => {
      const payload = previous[record.id];
      if (!payload) return previous;
      // Functional updates avoid losing a field when two optional edits arrive together.
      const current = payload.fields ?? [];
      const exists = current.some(field => pensionFieldKey(field.label) === key);
      const next = { label: PENSION_LABELS[key], value, confidence: 0, reviewSuggestion: false };
      return { ...previous, [record.id]: { ...payload, fields: exists
        ? current.map(field => pensionFieldKey(field.label) === key ? next : field)
        : [...current, next] } };
    });
  }

  function handleExtractedTransactionChange(
    documentType: string,
    transactionIndex: number,
    patch: Partial<ExtractedTransaction>,
  ) {
    const record = documentRecords[documentType];
    if (!record) return;

    setExtractedByDocumentId((previous) => {
      const payload = previous[record.id];
      if (!payload?.transactions) return previous;
      const transactions = payload.transactions.map((transaction, index) =>
        index === transactionIndex ? { ...transaction, ...patch } : transaction,
      );
      return { ...previous, [record.id]: { ...payload, transactions } };
    });
  }

  async function handleSaveDocumentReview(documentType: string) {
    const record = documentRecords[documentType];
    if (!record) return;
    const payload = extractedByDocumentId[record.id];
    if (!payload) return;

    setSavingDocumentReviewId(record.id);
    setDocumentUploadError(null);
    setProfileSyncNote(null);
    const result = await updateDocumentExtractionAction(record.id, payload);
    setSavingDocumentReviewId(null);

    if (!result.success) {
      setDocumentUploadError(result.error ?? "Failed to save extracted data");
      return;
    }

    setDocumentRecords((previous) => ({
      ...previous,
      [documentType]: { ...record, extractionStatus: "COMPLETED" },
    }));
    if (isBankProfitCertificate(documentType)) {
      setExtractedByDocumentId((previous) => {
        const payload = previous[record.id];
        if (!payload) return previous;
        const nextPayload = { ...payload };
        delete nextPayload.approvedBankProfitCertificate;
        return { ...previous, [record.id]: nextPayload };
      });
    }
    if (documentType === "pension_statement" || isBankProfitCertificate(documentType))
      resetDownstreamSteps(step, true);
  }

  async function handleRecoverBusinessPurchaseBasis(documentType: string) {
    const record = documentRecords[documentType];
    if (!record || documentType !== "business_books") return;
    setSavingDocumentReviewId(record.id);
    setDocumentUploadError(null);
    try {
      const result = await recoverBusinessPurchaseBasisAction(record.id);
      if (!result.success || !result.extraction) {
        setDocumentUploadError(
          result.error || "Purchase basis could not be recovered.",
        );
        return;
      }
      setExtractedByDocumentId((previous) => ({
        ...previous,
        [record.id]: result.extraction as ExtractedPayload,
      }));
      setDocumentRecords((previous) => ({
        ...previous,
        [documentType]: { ...record, extractionStatus: "COMPLETED" },
      }));
      resetDownstreamSteps(step);
      setProfileSyncNote(
        "Purchase basis re-read from your original Books. Review it, then Save & Approve Map; earlier amounts were preserved.",
      );
    } catch {
      setDocumentUploadError(
        "Could not contact document recovery. Refresh and check its saved status before retrying.",
      );
    } finally {
      setSavingDocumentReviewId(null);
    }
  }

  async function handleMapDocument(documentType: string) {
    const record = documentRecords[documentType];
    if (!record) return;

    setMappingDocumentId(record.id);
    setDocumentUploadError(null);
    setProfileSyncNote(null);
    const extracted = extractedByDocumentId[record.id];
    if (!extracted) {
      setMappingDocumentId(null);
      setDocumentUploadError("Review the extracted data before mapping");
      return;
    }

    const saveResult = await updateDocumentExtractionAction(
      record.id,
      extracted,
    );
    if (!saveResult.success) {
      setMappingDocumentId(null);
      setDocumentUploadError(saveResult.error ?? "Failed to save corrections");
      return;
    }

    if (isBankProfitCertificate(documentType)) {
      setExtractedByDocumentId((previous) => {
        const payload = previous[record.id];
        if (!payload) return previous;
        const nextPayload = { ...payload };
        delete nextPayload.approvedBankProfitCertificate;
        return { ...previous, [record.id]: nextPayload };
      });
    }
    if (documentType === "pension_statement" || isBankProfitCertificate(documentType)) {
      setDocumentRecords((previous) => ({
        ...previous,
        [documentType]: { ...record, extractionStatus: "COMPLETED" },
      }));
      resetDownstreamSteps(step, true);
    }
    const result = await approveAndMapExtractedDocumentAction(record.id);
    setMappingDocumentId(null);
    if (!result.success) {
      setDocumentUploadError(
        result.error ?? "Failed to map extracted document",
      );
      return;
    }

    setProfileSyncNote(
      result.mapping === "BANK_PROFIT_CERTIFICATE"
        ? "Bank-profit certificate fields are approved and saved as canonical evidence. The printed section, rate and ATL status are not converted into a legal tax treatment; reconcile them before calculation/portal entry."
        : result.mapping === "PENSION"
          ? "Pension statement facts approved. Recalculate Tax; unresolved withholding or tax-basis review will remain on hold. Generate a fresh packet after tax is ready. Bank cash receipts and profile DOB were not changed."
          : describeCnicProfilePlan(
              (
                result as {
                  profilePlan?: {
                    filled?: string[];
                    skipped?: { field: string }[];
                  };
                }
              ).profilePlan,
            ),
    );
    if (
      result.mapping === "BANK_PROFIT_CERTIFICATE" &&
      "certificate" in result
    ) {
      setExtractedByDocumentId((previous) => {
        const payload = previous[record.id];
        if (!payload) return previous;
        return {
          ...previous,
          [record.id]: {
            ...payload,
            approvedBankProfitCertificate: result.certificate,
          },
        };
      });
    }
    if (result.mapping === "CNIC" && typeof window !== "undefined") {
      window.dispatchEvent(new Event("taxrocket-profile-updated"));
    }

    setDocumentRecords((previous) => ({
      ...previous,
      [documentType]: { ...record, extractionStatus: "MAPPED" },
    }));
    // Mapping a bank statement stores its IBAN on the account.
    if (documentType.startsWith("bank_statement")) onBankAccountsChanged?.();

    if (draftId) {
      const refreshedSummary = await getFilingSummaryAction(draftId);
      if (refreshedSummary.success) {
        setFilingSummary(refreshedSummary.summary as FilingSummary);
      }
    }
  }

  /**
   * Enter the IBAN on a statement that is already mapped (it was mapped before
   * the IBAN was required). Does not re-map or touch transactions.
   */
  async function handleSaveStatementIban(documentType: string) {
    const record = documentRecords[documentType];
    if (!record) return;
    const payload = extractedByDocumentId[record.id];
    const ibanField = payload?.fields?.find((field) =>
      /(^|_)iban(_|$)/.test(
        field.label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      ),
    );

    setSavingDocumentReviewId(record.id);
    setDocumentUploadError(null);
    const result = await saveBankStatementIbanAction(
      record.id,
      String(ibanField?.value ?? ""),
    );
    setSavingDocumentReviewId(null);
    if (!result.success) {
      setDocumentUploadError(result.error ?? "Failed to save the IBAN");
      return;
    }
    onBankAccountsChanged?.();
  }

  /**
   * Change the employer name(s) on a salary certificate that is already
   * mapped. No re-upload or re-extraction; the latest packet is superseded
   * on the server, so the summary is refreshed afterwards.
   */
  async function handleSaveSalaryEmployers(documentType: string) {
    const record = documentRecords[documentType];
    if (!record) return;
    const payload = extractedByDocumentId[record.id];
    const kindOf = (label: string) => {
      const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      if (!/(^|_)employers?(_|$)/.test(normalized)) return null;
      if (
        /(^|_)(ntn|ftn|cnic|nic|id|no|number|address|reg|registration|phone|email)(_|$)/.test(
          normalized,
        )
      )
        return null;
      return /(^|_)(other|additional|more)(_|$)/.test(normalized)
        ? "other"
        : "main";
    };
    const valueOf = (kind: "main" | "other") =>
      String(
        payload?.fields?.find((field) => kindOf(field.label) === kind)?.value ??
          "",
      );

    setSavingDocumentReviewId(record.id);
    setDocumentUploadError(null);
    const result = await saveSalaryCertificateEmployersAction(record.id, {
      employerName: valueOf("main"),
      otherEmployerNames: valueOf("other"),
    });
    setSavingDocumentReviewId(null);
    if (!result.success) {
      setDocumentUploadError(
        result.error ?? "Failed to save the employer names",
      );
      return;
    }
    setSavedEmployerSignatures((previous) => ({
      ...previous,
      [record.id]: salaryCertificateEmployerSignature(payload?.fields),
    }));
    setProfileSyncNote(
      "Employer saved. Generate and approve the filing packet again so the new name reaches FBR.",
    );
    if (draftId) {
      const refreshedSummary = await getFilingSummaryAction(draftId);
      if (refreshedSummary.success) {
        setFilingSummary(refreshedSummary.summary as FilingSummary);
      }
    }
  }

  /** True when the employer fields differ from what was last saved. */
  function isSalaryEmployerDirty(documentType: string) {
    const record = documentRecords[documentType];
    if (!record || record.extractionStatus !== "MAPPED") return false;
    const baseline = savedEmployerSignatures[record.id];
    const payload = extractedByDocumentId[record.id];
    if (baseline === undefined || !payload?.fields) return false;
    return salaryCertificateEmployerSignature(payload.fields) !== baseline;
  }
  const hasUnsavedSalaryEmployers = isSalaryEmployerDirty("salary_certificate");

  return {
    isSalaryEmployerDirty,
    hasUnsavedSalaryEmployers,
    uploadedDocuments,
    documentRecords,
    extractedByDocumentId,
    extractingDocumentId,
    reviewingDocumentId,
    savingDocumentReviewId,
    mappingDocumentId,
    selectedDocumentFiles,
    uploadingDocumentType,
    documentUploadError,
    profileSyncNote,
    setProfileSyncNote,
    uploadFileInputsRef,
    setUploadedDocuments,
    setDocumentRecords,
    setSelectedDocumentFiles,
    setUploadingDocumentType,
    setDocumentUploadError,
    triggerDocumentUpload,
    handleDocumentFileSelected,
    handleExtractDocument,
    handleReviewDocument,
    handleExtractedFieldChange,
    handlePensionReviewFieldChange,
    handleExtractedTransactionChange,
    handleSaveDocumentReview,
    handleMapDocument,
    handleRecoverBusinessPurchaseBasis,
    handleSaveStatementIban,
    handleSaveSalaryEmployers,
  };
}
