// Shared shapes for both data sources (bundled sample files and live Snowflake).
export type Source = 'mock' | 'live';
export interface Provenance { source: Source; latencyMs?: number }

export type Tier = 'Fast track' | 'Standard' | 'Complex' | 'SIU referral';
export const TIERS: Tier[] = ['Fast track', 'Standard', 'Complex', 'SIU referral'];

export const DOC_TYPE_LABEL: Record<string, string> = {
  fnol_email: 'FNOL email', claim_form: 'Claim form', repair_estimate: 'Repair estimate',
  police_report: 'Police report', medical_bill: 'Medical bill', damage_photo: 'Damage photo',
};

export interface InboxDoc {
  docId: string; claimId: string; fileName: string; receivedAt: string; source: string;
  docType: string | null; status: 'Extracted' | 'Needs review' | 'Queued';
  confidence: number | null; insured: string; lossType: string;
}
export interface Inbox {
  provenance: Provenance;
  kpis: { received: number; extracted: number; needsReview: number; newClaims: number; typeAccuracy: number | null; lastRun: string | null };
  byType: { docType: string; count: number }[];
  docs: InboxDoc[];
}

export interface DocDetail {
  docId: string; fileName: string; docType: string | null; receivedAt: string; source: string;
  text: string | null; fields: Record<string, string>; scores: Record<string, number>;
  lineItems: { description: string; amount: string }[]; photoDescription: string | null; url: string;
}
export interface Coverage {
  policyFound: boolean; policyActive: boolean | null; inceptionDate: string | null; daysSinceInception: number | null;
  coveragePart: string; deductible: number | null; biLimitPerPerson: number | null; medPayLimit: number | null;
  estimateTotal: number | null; estimateLineSum: number | null; estimateMismatch: boolean;
  medicalTotal: number; medicalBills: number; medicalSeries: number[]; policeReportLagDays: number | null;
  priorLosses: number; priorPaid: number;
}
export interface TriageResult {
  summary: string; tier: Tier; suggestedAdjuster: string | null; model: string; generatedAt: string; facts: string;
  provenance?: Provenance;
}
export interface Adjuster { adjusterId: string; name: string; skills: string; capacity: number; openClaims: number }
export interface ClaimAction {
  claimId: string; action: 'accept' | 'correct' | 'route'; fieldName?: string; oldValue?: string; newValue?: string;
  tier?: string; adjusterId?: string; comment?: string; actedAt?: string;
}
export interface ClaimFile {
  provenance: Provenance;
  claim: { claimId: string; insured: string; lossType: string; lossDate: string; reportedDate: string; lossLocation: string;
    vehicle: string; status: string; assignedAdjuster: string | null; policyNumber: string };
  policy: Record<string, string | number | boolean | null> | null;
  docs: DocDetail[]; coverage: Coverage; triage: TriageResult | null;
  notes: { noteId: string; author: string; createdAt: string; text: string }[];
  lossHistory: { lossDate: string; carrier: string; lossType: string; paid: number }[];
  actions: ClaimAction[]; adjusters: Adjuster[];
}

export interface BoardClaim {
  claimId: string; insured: string; lossType: string; reportedDate: string; status: string; tier: Tier;
  adjuster: string | null; suggestedAdjuster: string | null; flags: string[];
}
export interface Board {
  provenance: Provenance;
  claims: BoardClaim[]; adjusters: Adjuster[];
  cycle: { month: string; tier: Tier; avgDays: number; closed: number }[];
}

export interface Citation { id: string; sourceType: string; name: string; date: string; snippet: string }
export interface Answer { answer: string; citations: Citation[]; provenance: Provenance }
