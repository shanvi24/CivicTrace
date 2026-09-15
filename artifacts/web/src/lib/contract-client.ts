import { BrowserProvider, Contract, Interface, type TransactionReceipt } from 'ethers';
import { civicTraceContract, SEPOLIA_CHAIN_ID } from './contract-config';

export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

export type OnChainUpdate = {
  message: string;
  author: string;
  timestamp: bigint;
};

export type OnChainComplaint = {
  id: bigint;
  title: string;
  issueType: string;
  location: string;
  createdAt: bigint;
  reporter: string;
  status: number;
  description: string;
  evidenceHash: string;
  priority: string;
  assignedDepartment: string;
  resolutionProofHash: string;
  resolutionSubmittedAt: bigint;
  verifiedAt: bigint;
  challenged: boolean;
  challengeReason: string;
  updates: OnChainUpdate[];
};

export class MetaMaskUnavailableError extends Error {
  constructor() {
    super('MetaMask is not installed.');
    this.name = 'MetaMaskUnavailableError';
  }
}

export class WrongNetworkError extends Error {
  constructor() {
    super('Please switch MetaMask to Ethereum Sepolia (chain ID 11155111).');
    this.name = 'WrongNetworkError';
  }
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function getEthereum(): EthereumProvider {
  if (!window.ethereum) throw new MetaMaskUnavailableError();
  return window.ethereum;
}

export function getContractErrorMessage(error: unknown): string {
  const value = error as { code?: number | string; shortMessage?: string; reason?: string; message?: string };
  if (value?.code === 4001 || value?.code === 'ACTION_REJECTED' || value?.message?.toLowerCase().includes('user rejected')) {
    return 'MetaMask rejected the transaction. No changes were made.';
  }
  const message = value?.reason || value?.shortMessage || value?.message || 'The contract call failed.';
  if (message.toLowerCase().includes('complaint does not exist')) {
    return 'That complaint ID does not exist on Sepolia.';
  }
  if (message.toLowerCase().includes('only authority')) {
    return 'This wallet is not the contract authority.';
  }
  if (message.toLowerCase().includes('wrong network') || message.toLowerCase().includes('chain')) {
    return 'Please switch MetaMask to Ethereum Sepolia (chain ID 11155111).';
  }
  return message.replace(/^execution reverted:\s*/i, '').trim();
}

async function createProvider() {
  const ethereum = getEthereum();
  const provider = new BrowserProvider(ethereum as never);
  const network = await provider.getNetwork();
  if (network.chainId !== SEPOLIA_CHAIN_ID) throw new WrongNetworkError();
  return { ethereum, provider };
}

async function getReadContract() {
  const { provider } = await createProvider();
  return { provider, contract: new Contract(civicTraceContract.address, civicTraceContract.abi, provider) };
}

async function getWriteContract() {
  const { provider } = await createProvider();
  const signer = await provider.getSigner();
  return { provider, contract: new Contract(civicTraceContract.address, civicTraceContract.abi, signer) };
}

export async function connectWallet() {
  const ethereum = getEthereum();
  const provider = new BrowserProvider(ethereum as never);
  const accounts = (await ethereum.request({ method: 'eth_requestAccounts' })) as string[];
  const network = await provider.getNetwork();
  if (network.chainId !== SEPOLIA_CHAIN_ID) throw new WrongNetworkError();
  const address = accounts[0] || (await provider.getSigner()).address;
  const contract = new Contract(civicTraceContract.address, civicTraceContract.abi, provider);
  const isAuthority = Boolean(await contract.isAdmin(address));
  return { address, isAuthority };
}

export async function readComplaintCount(): Promise<number> {
  const { contract } = await getReadContract();
  const count = (await contract.complaintCount()) as bigint;
  return Number(count);
}

export async function readIsAdmin(address: string): Promise<boolean> {
  const { contract } = await getReadContract();
  return Boolean(await contract.isAdmin(address));
}

export async function readComplaint(complaintId: bigint): Promise<OnChainComplaint> {
  const { contract } = await getReadContract();
  const [basic, details, resolution, challenge, updateCountResult] = await Promise.all([
    contract.getComplaintBasic(complaintId),
    contract.getComplaintDetails(complaintId),
    contract.getResolution(complaintId),
    contract.getChallenge(complaintId),
    contract.getUpdateCount(complaintId),
  ]);
  const updateCount = Number(updateCountResult as bigint);
  const updates = await Promise.all(
    Array.from({ length: updateCount }, (_, index) => contract.getUpdate(complaintId, index)),
  );
  return {
    id: basic[0] as bigint,
    title: basic[1] as string,
    issueType: basic[2] as string,
    location: basic[3] as string,
    createdAt: basic[4] as bigint,
    reporter: basic[5] as string,
    status: Number(basic[6]),
    description: details[0] as string,
    evidenceHash: details[1] as string,
    priority: details[2] as string,
    assignedDepartment: details[3] as string,
    resolutionProofHash: resolution[0] as string,
    resolutionSubmittedAt: resolution[1] as bigint,
    verifiedAt: resolution[2] as bigint,
    challenged: Boolean(challenge[0]),
    challengeReason: challenge[1] as string,
    updates: updates.map((update) => ({
      message: update[0] as string,
      author: update[1] as string,
      timestamp: update[2] as bigint,
    })),
  };
}

export async function readAllComplaints(): Promise<OnChainComplaint[]> {
  const count = await readComplaintCount();
  return Promise.all(Array.from({ length: count }, (_, index) => readComplaint(BigInt(index + 1))));
}

export async function createComplaint(input: {
  title: string;
  issueType: string;
  description: string;
  location: string;
  evidenceHash: string;
  priority: string;
}) {
  const { contract } = await getWriteContract();
  const transaction = await contract.createComplaint(
    input.title,
    input.issueType,
    input.description,
    input.location,
    input.evidenceHash,
    input.priority,
  );
  const receipt = (await transaction.wait()) as TransactionReceipt;
  const iface = new Interface(civicTraceContract.abi);
  const createdLog = receipt.logs
    .map((log) => {
      try {
        return iface.parseLog({ topics: log.topics as string[], data: log.data });
      } catch {
        return null;
      }
    })
    .find((log) => log?.name === 'ComplaintCreated');
  const complaintId = createdLog ? (createdLog.args[0] as bigint) : BigInt(await readComplaintCount());
  return { complaintId, transactionHash: receipt.hash };
}

export async function writeContract(method: string, args: readonly unknown[]) {
  const { contract } = await getWriteContract();
  const transaction = await (contract as unknown as Record<string, (...values: readonly unknown[]) => Promise<{ wait: () => Promise<TransactionReceipt> }>>)[method](...args);
  const receipt = await transaction.wait();
  return { transactionHash: receipt.hash };
}