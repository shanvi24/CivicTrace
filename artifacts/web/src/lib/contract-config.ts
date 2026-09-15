export const SEPOLIA_CHAIN_ID = 11155111n;

// Verified CivicTrust ABI fragments. These signatures match the deployed
// contract and are kept separate from the UI so the address/ABI can be
// replaced without changing any screens.
export const civicTraceContract = {
  address: '0x5e8bFe869E9C4E59615D7323C1e7334aFcd1c55b',
  chainId: SEPOLIA_CHAIN_ID,
  abi: [
    'event ComplaintCreated(uint256 indexed complaintId, string issueType, uint256 timestamp)',
    'function complaintCount() view returns (uint256)',
    'function createComplaint(string _title, string _issueType, string _description, string _location, string _evidenceHash, string _priority)',
    'function getComplaintBasic(uint256 _complaintId) view returns (uint256 id, string title, string issueType, string location, uint256 createdAt, address reporter, uint8 status)',
    'function getComplaintDetails(uint256 _complaintId) view returns (string description, string evidenceHash, string priority, string assignedDepartment)',
    'function getResolution(uint256 _complaintId) view returns (string resolutionProofHash, uint256 resolutionSubmittedAt, uint256 verifiedAt)',
    'function getChallenge(uint256 _complaintId) view returns (bool challenged, string challengeReason)',
    'function getUpdateCount(uint256 _complaintId) view returns (uint256)',
    'function getUpdate(uint256 _complaintId, uint256 _index) view returns (string message, address author, uint256 timestamp)',
    'function isAdmin(address _address) view returns (bool)',
    'function startReview(uint256 _complaintId)',
    'function assignComplaint(uint256 _complaintId, string _department)',
    'function startWork(uint256 _complaintId)',
    'function addAuthorityUpdate(uint256 _complaintId, string _message)',
    'function submitResolutionProof(uint256 _complaintId, string _proofHash)',
    'function markResolved(uint256 _complaintId)',
    'function confirmResolution(uint256 _complaintId)',
    'function challengeResolution(uint256 _complaintId, string _reason)',
  ] as const,
} as const;