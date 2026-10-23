import {
  BANK_PROFIT_FINAL_TAX_ROWS,
  type BankProfitSubcategory,
} from "./iris-bank-profit-capture";

const PREFIX = "bank_certificate:";

export function bankProfitCertificateSlot(subcategory: BankProfitSubcategory) {
  return `${PREFIX}${subcategory}`;
}

export function bankProfitCertificateSubcategory(documentType: string) {
  if (!documentType.startsWith(PREFIX)) return null;
  const subcategory = documentType.slice(PREFIX.length);
  return Object.prototype.hasOwnProperty.call(BANK_PROFIT_FINAL_TAX_ROWS, subcategory)
    ? (subcategory as BankProfitSubcategory)
    : null;
}

export function isBankProfitCertificate(documentType: string) {
  return documentType === "bank_certificate" || bankProfitCertificateSubcategory(documentType) !== null;
}

export function baseFilingDocumentType(documentType: string) {
  return isBankProfitCertificate(documentType) ? "bank_certificate" : documentType;
}
