import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardList,
  Clock3,
  FileCheck2,
  FileText,
  HeartHandshake,
  LayoutDashboard,
  Link2,
  LocateFixed,
  MapPin,
  Menu,
  MessageSquareText,
  Paperclip,
  Plus,
  Search,
  Send,
  ShieldCheck,
  UploadCloud,
  WalletCards,
  X,
} from 'lucide-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { civicTraceContract } from '@/lib/contract-config';
import {
  connectWallet as connectContractWallet,
  createComplaint as createOnChainComplaint,
  getContractErrorMessage,
  getEthereum,
  readAllComplaints,
  readIsAdmin,
  readComplaint,
  writeContract,
  type OnChainComplaint,
} from '@/lib/contract-client';

const queryClient = new QueryClient();

type Status = 'Pending' | 'Reported' | 'Acknowledged' | 'Assigned' | 'In Progress' | 'Resolved' | 'Verified' | 'Confirmed';
type Complaint = {
  id: string;
  contractId?: bigint;
  title: string;
  category: string;
  description: string;
  location: string;
  priority: string;
  date: string;
  status: Status;
  department: string;
  updates: { status: string; timestamp: string; action: string }[];
  transactionHash?: string;
  challenged?: boolean;
  challengeReason?: string;
  resolutionProofHash?: string;
};

const initialComplaints: Complaint[] = [
  {
    id: 'CT-2025-184', title: 'Crosswalk signal out on Larch Avenue', category: 'Road Safety',
    description: 'The pedestrian signal has been dark for three evenings, making the crossing difficult after sunset.',
    location: 'Larch Avenue & 8th Street', priority: 'High', date: 'Oct 14, 2025', status: 'In Progress',
    department: 'Department of Transportation',
    updates: [
      { status: 'Reported', timestamp: 'Oct 14 · 08:42', action: 'Complaint recorded by resident' },
      { status: 'Acknowledged', timestamp: 'Oct 14 · 11:16', action: 'Intake team confirmed the report' },
      { status: 'Assigned', timestamp: 'Oct 15 · 09:04', action: 'Assigned to Traffic Signals Unit' },
      { status: 'In Progress', timestamp: 'Oct 16 · 14:20', action: 'Field inspection scheduled' },
    ],
  },
  {
    id: 'CT-2025-179', title: 'Streetlight flickering near the library', category: 'Streetlight',
    description: 'One of the lamps on the north side of Juniper Square flickers and goes out overnight.',
    location: 'Juniper Square, north entrance', priority: 'Normal', date: 'Oct 10, 2025', status: 'Resolved',
    department: 'Public Works',
    updates: [
      { status: 'Reported', timestamp: 'Oct 10 · 17:28', action: 'Complaint recorded by resident' },
      { status: 'Acknowledged', timestamp: 'Oct 11 · 08:10', action: 'Public Works acknowledged the issue' },
      { status: 'Assigned', timestamp: 'Oct 11 · 10:32', action: 'Assigned to Electrical Maintenance' },
      { status: 'In Progress', timestamp: 'Oct 12 · 13:05', action: 'Replacement part ordered' },
      { status: 'Resolved', timestamp: 'Oct 13 · 16:40', action: 'Lamp replaced and tested' },
    ],
  },
  {
    id: 'CT-2025-171', title: 'Overflowing waste bins at Market Row', category: 'Waste',
    description: 'The public bins along Market Row have not been cleared since the weekend market.',
    location: 'Market Row, between 3rd and 4th', priority: 'Normal', date: 'Oct 04, 2025', status: 'Verified',
    department: 'Sanitation Services',
    updates: [
      { status: 'Reported', timestamp: 'Oct 04 · 12:22', action: 'Complaint recorded by resident' },
      { status: 'Acknowledged', timestamp: 'Oct 04 · 15:02', action: 'Sanitation Services acknowledged' },
      { status: 'Assigned', timestamp: 'Oct 05 · 07:30', action: 'Assigned to Market District crew' },
      { status: 'In Progress', timestamp: 'Oct 05 · 09:14', action: 'Collection route dispatched' },
      { status: 'Resolved', timestamp: 'Oct 05 · 11:46', action: 'Bins emptied and area cleaned' },
      { status: 'Verified', timestamp: 'Oct 06 · 08:00', action: 'Resolution verified by resident' },
    ],
  },
  {
    id: 'CT-2025-166', title: 'Pothole widening after recent rain', category: 'Pothole',
    description: 'A deep pothole has opened in the right lane and is collecting water.',
    location: 'Belmont Road, southbound', priority: 'Urgent', date: 'Sep 28, 2025', status: 'Acknowledged',
    department: 'Road Maintenance',
    updates: [
      { status: 'Reported', timestamp: 'Sep 28 · 10:05', action: 'Complaint recorded by resident' },
      { status: 'Acknowledged', timestamp: 'Sep 29 · 09:22', action: 'Road Maintenance acknowledged the issue' },
    ],
  },
];

const timelineStatuses: Status[] = ['Reported', 'Acknowledged', 'Assigned', 'In Progress', 'Resolved', 'Verified'];
const departments: Record<string, string> = {
  'Pothole': 'Road Maintenance', 'Streetlight': 'Public Works', 'Water Leak': 'Water Services',
  'Waste': 'Sanitation Services', 'Road Safety': 'Department of Transportation',
  'Infrastructure': 'Capital Projects', 'Other': 'Civic Response Desk',
};

const contractStatusLabels: Status[] = ['Reported', 'Acknowledged', 'Assigned', 'In Progress', 'Resolved', 'Resolved', 'Verified', 'Reported'];

function formatChainTimestamp(timestamp: bigint) {
  if (!timestamp) return 'Awaiting update';
  return new Date(Number(timestamp) * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function onChainComplaintToUi(complaint: OnChainComplaint): Complaint {
  const status = contractStatusLabels[complaint.status] || 'Reported';
  const updates = [
    { status: 'Reported', timestamp: formatChainTimestamp(complaint.createdAt), action: 'Complaint recorded on Sepolia' },
    ...complaint.updates.map((update) => ({
      status,
      timestamp: formatChainTimestamp(update.timestamp),
      action: update.message,
    })),
  ];
  if (status !== 'Reported' && !updates.some((update) => update.status === status)) {
    updates.push({ status, timestamp: 'On-chain status', action: `Status is ${status}` });
  }
  if (complaint.resolutionSubmittedAt) {
    updates.push({ status: 'Resolved', timestamp: formatChainTimestamp(complaint.resolutionSubmittedAt), action: 'Resolution proof submitted' });
  }
  if (complaint.verifiedAt) {
    updates.push({ status: 'Verified', timestamp: formatChainTimestamp(complaint.verifiedAt), action: 'Resolution verified by resident' });
  }
  return {
    id: `CT-${complaint.id.toString()}`,
    contractId: complaint.id,
    title: complaint.title,
    category: complaint.issueType,
    description: complaint.description,
    location: complaint.location,
    priority: complaint.priority,
    date: formatChainTimestamp(complaint.createdAt),
    status,
    department: complaint.assignedDepartment || departments[complaint.issueType] || 'Civic Response Desk',
    updates,
    challenged: complaint.challenged,
    challengeReason: complaint.challengeReason,
    resolutionProofHash: complaint.resolutionProofHash,
  };
}

function parseComplaintId(value: string) {
  const match = value.trim().match(/(\d+)$/);
  return match ? BigInt(match[1]) : null;
}

function statusClass(status: string) {
  return `ct-status status-${status.toLowerCase().replaceAll(' ', '-')}`;
}

function shortWallet(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function AppShell({ children, wallet, onConnect }: { children: ReactNode; wallet: string; onConnect: () => void }) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const nav = [
    { href: '/', label: 'Home' }, { href: '/report', label: 'Report' }, { href: '/track', label: 'Track' },
    { href: '/dashboard', label: 'My dashboard' }, { href: '/authority', label: 'Authority' },
  ];
  return (
    <div className="ct-app">
      <div className="ct-shell">
        <header className="ct-nav">
          <Link href="/" className="ct-brand" data-testid="link-brand">
            <span className="ct-brand-mark"><span /></span><span>Civic Trace</span>
          </Link>
          <nav className={`ct-nav-links ${menuOpen ? 'open' : ''}`} aria-label="Main navigation">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className={`ct-nav-link ${location === item.href ? 'active' : ''}`} data-testid={`link-nav-${item.label.toLowerCase().replaceAll(' ', '-')}`} onClick={() => setMenuOpen(false)}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="ct-wallet" onClick={onConnect} data-testid="button-connect-wallet">
              <WalletCards size={14} style={{ verticalAlign: 'middle', marginRight: 5 }} />
              {wallet ? shortWallet(wallet) : 'Connect wallet'}
            </button>
            <button className="ct-mobile-menu" onClick={() => setMenuOpen((value) => !value)} aria-label="Open navigation" data-testid="button-mobile-menu">
              {menuOpen ? <X size={21} /> : <Menu size={21} />}
            </button>
          </div>
        </header>
        {children}
        <footer className="ct-footer">
          <strong>CIVIC TRACE</strong>
          <span>A public record for the places we share. · Demo environment · <span className="font-mono">{civicTraceContract.address || 'contract pending'}</span></span>
        </footer>
      </div>
    </div>
  );
}

function HomePage() {
  return (
    <main>
      <section className="ct-hero">
        <div>
          <div className="ct-eyebrow">A civic record, held in common</div>
          <h1 className="ct-display">Report a problem.<br /><span className="ct-hero-highlight">Watch it get fixed</span></h1>
          <p className="ct-hero-copy">Report civic problems, track action, and verify resolution. Civic Trace gives every issue a clear public path from first signal to final fix.</p>
          <div className="ct-actions">
            <Link href="/report" className="ct-btn ct-btn-gold" data-testid="link-hero-report">Report an issue <ArrowRight size={15} /></Link>
            <Link href="/track" className="ct-btn ct-btn-ghost" data-testid="link-hero-track">Track a complaint <Search size={14} /></Link>
          </div>
          <div className="ct-note"><ShieldCheck size={14} color="#8cbea1" /> Every update is time-stamped and visible to the people it affects.</div>
        </div>
        <div className="ct-hero-map ct-float" aria-label="Illustrated city map with active civic reports">
          <div className="ct-map-grid" /><div className="ct-map-water" />
          <div className="ct-map-road r1" /><div className="ct-map-road r2" /><div className="ct-map-road r3" /><div className="ct-map-road r4" />
          <div className="ct-map-line m1" /><div className="ct-map-line m2" />
          <div className="ct-map-label l1">NORTH QUARTER</div><div className="ct-map-label l2">JUNIPER SQUARE</div><div className="ct-map-label l3">MARKET ROW</div>
          <div className="ct-pin p1" /><div className="ct-pin p2" /><div className="ct-pin p3" /><div className="ct-map-node n1" /><div className="ct-map-node n2" /><div className="ct-map-node n3" />
          <div className="ct-map-caption"><div><strong>LIVE CIVIC RECORD</strong><span>3 active reports in your city</span></div><MapPin size={17} color="#d9b979" /></div>
        </div>
      </section>
      <section className="ct-section ct-section-rule">
        <div className="ct-eyebrow">How it holds</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 30, alignItems: 'end', flexWrap: 'wrap', marginTop: 10 }}>
          <h2 className="ct-display" style={{ fontSize: 'clamp(35px, 5vw, 60px)', maxWidth: 590, margin: 0 }}>Small signals.<br /><span style={{ color: '#d9b979' }}>Visible movement.</span></h2>
          <p className="ct-muted" style={{ maxWidth: 320, lineHeight: 1.6, fontSize: 14, margin: 0 }}>A good report is more than a form. It is a shared point of reference between residents and the people responsible for a place.</p>
        </div>
        <div className="ct-process">
          {[
            ['01', 'REPORT', 'Put the problem on the record with context and location.'],
            ['02', 'RECORD', 'Receive a traceable ID and a permanent submission time.'],
            ['03', 'TRACK', 'See who has it, what is happening, and what comes next.'],
            ['04', 'RESOLVE', 'Departments add actions, not just changed statuses.'],
            ['05', 'VERIFY', 'Close the loop with confirmation from the community.'],
          ].map(([number, title, copy]) => <div className="ct-process-step" key={number}><span className="ct-index">{number}</span><h4>{title}</h4><p>{copy}</p></div>)}
        </div>
      </section>
      <section className="ct-section ct-section-rule">
        <div className="ct-eyebrow">The trace standard</div>
        <div className="ct-three" style={{ marginTop: 22 }}>
          <div className="ct-panel ct-principle"><span className="ct-index">/ 01</span><h3>Accountability without theatre.</h3><p>Status is useful when it comes with a timestamp, a responsible team, and a next action.</p></div>
          <div className="ct-panel ct-principle"><span className="ct-index">/ 02</span><h3>Calm by design.</h3><p>Clear language and quiet interfaces make it easier to keep showing up for the places we share.</p></div>
          <div className="ct-panel ct-principle"><span className="ct-index">/ 03</span><h3>Proof over promises.</h3><p>Resolution is not the end of the record. Verification leaves the final word with residents.</p></div>
        </div>
      </section>
      <section className="ct-section" style={{ paddingTop: 15 }}>
        <div className="ct-panel" style={{ padding: '34px 38px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 25, flexWrap: 'wrap' }}>
          <div><div className="ct-eyebrow">Start where you are</div><h2 className="ct-display" style={{ fontSize: 36, margin: '9px 0 0' }}>Make the next civic issue legible.</h2></div>
          <Link href="/report" className="ct-btn ct-btn-gold" data-testid="link-bottom-report">Create a report <Plus size={15} /></Link>
        </div>
      </section>
    </main>
  );
}

function PageHeader({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <div className="ct-page-title"><div><div className="ct-eyebrow">{eyebrow}</div><h1 className="ct-display">{title}</h1></div><p>{copy}</p></div>;
}

function ReportPage({ onCreate, notify }: { onCreate: (input: { title: string; category: string; description: string; location: string; priority: string; file: string }) => Promise<Complaint>; notify: (message: string) => void }) {
  const [form, setForm] = useState({ title: '', category: 'Pothole', description: '', location: '', priority: 'Normal', file: '' });
  const [stage, setStage] = useState<'idle' | 'pending' | 'confirmed' | 'failed'>('idle');
  const [created, setCreated] = useState<Complaint | null>(null);
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.title.trim() || !form.description.trim() || !form.location.trim()) {
      setStage('failed'); notify('Add a title, description, and location to create the record.'); return;
    }
    setStage('pending');
    try {
      const complaint = await onCreate(form);
      setCreated(complaint);
      setStage('confirmed');
      notify(`Complaint ${complaint.id} is now on the public record.`);
    } catch (error) {
      setStage('failed');
      notify(getContractErrorMessage(error));
    }
  };
  if (stage === 'confirmed' && created) {
    return <main className="ct-main"><PageHeader eyebrow="Report an issue / Complete" title="A record now exists." copy="Keep this ID somewhere safe. It is the key to every future update, action, and verification." />
      <div className="ct-panel ct-result">
        <div className="ct-result-top"><div><div className="ct-eyebrow">Complaint ID</div><h2>{created.id}</h2><p className="ct-muted" style={{ margin: 0, fontSize: 13 }}>Your report has been received and is waiting for department acknowledgement.</p></div><span className={statusClass('Confirmed')}>Confirmed</span></div>
         <div className="ct-result-grid"><div className="ct-result-cell"><span>Submitted</span><strong>{created.date}</strong></div><div className="ct-result-cell"><span>Responsible department</span><strong>{created.department}</strong></div><div className="ct-result-cell"><span>Transaction hash</span><strong>{created.transactionHash || 'Unavailable'}</strong></div></div>
        <div className="ct-actions"><Link href="/track" className="ct-btn ct-btn-gold" data-testid="link-result-track">Track this complaint <ArrowRight size={15} /></Link><button className="ct-btn ct-btn-ghost" onClick={() => { setStage('idle'); setCreated(null); setForm({ title: '', category: 'Pothole', description: '', location: '', priority: 'Normal', file: '' }); }} data-testid="button-report-another">Report another</button></div>
      </div>
    </main>;
  }
  return <main className="ct-main"><PageHeader eyebrow="Create a public record" title="Report an issue." copy="Give the right team enough signal to act. You can add photos, a precise location, and context in under two minutes." />
    <div className="ct-form-layout">
      <form className="ct-panel ct-form-panel" onSubmit={submit}>
        {stage === 'pending' && <div className="ct-panel" style={{ padding: '12px 15px', marginBottom: 20, background: 'rgba(217,185,121,.08)', color: '#e5c990', fontSize: 12 }}><Clock3 size={14} style={{ verticalAlign: 'middle', marginRight: 8 }} /> Writing your report to the Civic Trace record…</div>}
        {stage === 'failed' && <div className="ct-panel" style={{ padding: '12px 15px', marginBottom: 20, background: 'rgba(219,113,104,.08)', color: '#efaaa6', fontSize: 12 }}><X size={14} style={{ verticalAlign: 'middle', marginRight: 8 }} /> The record could not be created. Check the required fields and try again.</div>}
        <div className="ct-form-grid">
          <div className="ct-full"><label className="ct-label" htmlFor="report-title">Title</label><input id="report-title" className="ct-input" value={form.title} onChange={(e) => update('title', e.target.value)} placeholder="A short, specific description" data-testid="input-report-title" /></div>
          <div><label className="ct-label" htmlFor="report-category">Category</label><select id="report-category" className="ct-select" value={form.category} onChange={(e) => update('category', e.target.value)} data-testid="select-report-category">{['Pothole', 'Streetlight', 'Water Leak', 'Waste', 'Road Safety', 'Infrastructure', 'Other'].map((item) => <option value={item} key={item}>{item}</option>)}</select></div>
          <div><label className="ct-label" htmlFor="report-priority">Priority</label><select id="report-priority" className="ct-select" value={form.priority} onChange={(e) => update('priority', e.target.value)} data-testid="select-report-priority"><option>Normal</option><option>High</option><option>Urgent</option></select></div>
          <div className="ct-full"><label className="ct-label" htmlFor="report-description">Description</label><textarea id="report-description" className="ct-textarea" value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="What happened? When did you notice it? Who might be affected?" data-testid="textarea-report-description" /><div className="ct-help">Be factual and specific. This note will remain part of the public record.</div></div>
          <div className="ct-full"><label className="ct-label" htmlFor="report-location">Location</label><div style={{ position: 'relative' }}><LocateFixed size={15} color="#d9b979" style={{ position: 'absolute', left: 13, top: 14 }} /><input id="report-location" className="ct-input" style={{ paddingLeft: 38 }} value={form.location} onChange={(e) => update('location', e.target.value)} placeholder="Street, intersection, landmark or coordinates" data-testid="input-report-location" /></div></div>
          <div className="ct-full"><label className="ct-label">Image / evidence <span style={{ color: '#987d86', fontWeight: 400 }}>(optional)</span></label><label className="ct-upload" htmlFor="report-file"><UploadCloud size={19} /><br />{form.file || 'Drop a photo here, or browse files'}<input id="report-file" type="file" accept="image/*,.pdf" onChange={(e) => update('file', e.target.files?.[0]?.name || '')} data-testid="input-report-file" /></label></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 15, marginTop: 26, flexWrap: 'wrap' }}><span className="ct-help">By submitting, you agree this report can be visible to the public.</span><button className="ct-btn ct-btn-gold" type="submit" disabled={stage === 'pending'} data-testid="button-submit-report">{stage === 'pending' ? 'Recording…' : 'Submit report'} <Send size={14} /></button></div>
      </form>
      <aside className="ct-panel ct-side-panel"><h3>What happens next</h3><ol>{[['REPORT', 'Your signal is captured with location and context.'], ['RECORD', 'A permanent ID and timestamp make it findable.'], ['TRACK', 'Follow the responsible team and their updates.'], ['RESOLVE', 'Actions are added to the same visible thread.'], ['VERIFY', 'The community confirms the issue is actually fixed.']].map(([title, copy]) => <li key={title}><div><strong>{title}</strong><span>{copy}</span></div></li>)}</ol><div style={{ marginTop: 6, borderTop: '1px solid rgba(217,185,121,.16)', paddingTop: 17, color: '#a98b94', fontSize: 11, lineHeight: 1.5 }}><ShieldCheck size={14} color="#8cbea1" style={{ verticalAlign: 'middle', marginRight: 7 }} />MetaMask on Sepolia is required to submit a report.</div></aside>
    </div>
  </main>;
}

function Timeline({ complaint }: { complaint: Complaint }) {
  const completed = complaint.status === 'Confirmed' ? 0 : timelineStatuses.indexOf(complaint.status);
  return <div className="ct-timeline">{timelineStatuses.map((item, index) => {
    const event = complaint.updates.find((update) => update.status === item);
    return <div key={item} className={`ct-timeline-item ${index <= completed ? 'done' : ''} ${item === complaint.status ? 'current' : ''}`}><div className="ct-timeline-dot">{index <= completed ? <Check size={12} /> : <CircleDot size={11} />}</div><strong>{item}</strong><span>{event?.timestamp || 'Awaiting update'}</span></div>;
  })}</div>;
}

function ComplaintDetail({ complaint, onVerify, onChallenge }: { complaint: Complaint; onVerify: (complaintId: bigint) => Promise<void>; onChallenge: (complaintId: bigint, reason: string) => Promise<void> }) {
  const [challengeReason, setChallengeReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const runAction = async (action: () => Promise<void>) => {
    setActionBusy(true);
    try { await action(); } finally { setActionBusy(false); }
  };
  return <div className="ct-panel ct-track-result" data-testid={`card-track-result-${complaint.id}`}><div className="ct-detail-head"><div><div className="ct-eyebrow">Public record</div><h2>{complaint.id}</h2><div className="ct-row-main">{complaint.title}</div></div><span className={statusClass(complaint.status)}>{complaint.status}</span></div>
    <div className="ct-meta-grid"><div><span className="ct-meta-label">Location</span><span className="ct-meta-value"><MapPin size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />{complaint.location}</span></div><div><span className="ct-meta-label">Submitted</span><span className="ct-meta-value">{complaint.date}</span></div><div><span className="ct-meta-label">Department</span><span className="ct-meta-value">{complaint.department}</span></div><div><span className="ct-meta-label">Priority</span><span className="ct-meta-value">{complaint.priority}</span></div></div>
    <p className="ct-muted" style={{ fontSize: 13, lineHeight: 1.6, margin: '23px 0 0' }}>{complaint.description}</p><Timeline complaint={complaint} />
    {complaint.contractId && (complaint.status === 'Resolved' || complaint.status === 'Verified') && <div className="ct-control" style={{ marginTop: 28, borderTop: '1px solid rgba(217,185,121,.15)', paddingTop: 20 }}>
      <label>Resolution review</label>
      <div className="ct-control-row">
        <button className="ct-btn ct-btn-gold" disabled={actionBusy || complaint.status === 'Verified'} onClick={() => runAction(() => onVerify(complaint.contractId!))} data-testid="button-confirm-resolution"><CheckCircle2 size={14} /> {complaint.status === 'Verified' ? 'Verified' : 'Confirm resolution'}</button>
        <input className="ct-input" value={challengeReason} onChange={(event) => setChallengeReason(event.target.value)} placeholder="Challenge reason" data-testid="input-challenge-reason" />
        <button className="ct-btn ct-btn-ghost" disabled={actionBusy || !challengeReason.trim()} onClick={() => runAction(() => onChallenge(complaint.contractId!, challengeReason.trim()))} data-testid="button-challenge-resolution">Challenge</button>
      </div>
    </div>}
    <div style={{ marginTop: 35, borderTop: '1px solid rgba(217,185,121,.15)', paddingTop: 20 }}><div className="ct-eyebrow">Update log</div>{complaint.updates.slice().reverse().map((update) => <div key={`${update.status}-${update.timestamp}`} className="ct-activity-item"><div className="ct-activity-icon"><CheckCircle2 size={13} /></div><div><p><strong>{update.status}</strong> · {update.action}</p><span>{update.timestamp}</span></div></div>)}</div>
  </div>;
}

function TrackPage({ complaints, onLoadComplaint, onVerify, onChallenge, notify }: { complaints: Complaint[]; onLoadComplaint: (complaintId: bigint) => Promise<Complaint>; onVerify: (complaintId: bigint) => Promise<void>; onChallenge: (complaintId: bigint, reason: string) => Promise<void>; notify: (message: string) => void }) {
  const [lookup, setLookup] = useState(complaints[0]?.id || '');
  const [searched, setSearched] = useState('');
  const [result, setResult] = useState<Complaint | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const updated = complaints.find((complaint) => complaint.id.toLowerCase() === searched.trim().toLowerCase());
    if (updated) setResult(updated);
  }, [complaints, searched]);
  const findRecord = async () => {
    const complaintId = parseComplaintId(lookup);
    if (!complaintId) { notify('Enter a numeric complaint ID, such as CT-1.'); return; }
    setLoading(true);
    try {
      const existing = complaints.find((complaint) => complaint.contractId === complaintId);
      const record = existing || await onLoadComplaint(complaintId);
      setSearched(record.id);
      setResult(record);
    } catch (error) {
      setResult(null);
      notify(getContractErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };
  return <main className="ct-main"><PageHeader eyebrow="Follow the record" title="Track a complaint." copy="Every report has a path. Enter its ID to see the latest action, the responsible department, and what still needs to happen." />
    <div className="ct-lookup"><input className="ct-input" value={lookup} onChange={(e) => setLookup(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void findRecord()} placeholder="CT-1" data-testid="input-track-id" /><button className="ct-btn ct-btn-gold" onClick={() => void findRecord()} disabled={loading} data-testid="button-track-lookup">{loading ? 'Reading…' : 'Find record'} <Search size={14} /></button></div>
    {result ? <ComplaintDetail complaint={result} onVerify={onVerify} onChallenge={onChallenge} /> : <div className="ct-panel ct-empty" style={{ marginTop: 28 }}><Search size={24} color="#d9b979" /><h3>No record found</h3><p>Enter a complaint ID from the Sepolia contract, such as CT-1.</p></div>}
  </main>;
}

function DashboardPage({ complaints }: { complaints: Complaint[] }) {
  const stats = [
    ['Total', complaints.length, ''], ['Open', complaints.filter((c) => ['Reported', 'Pending', 'Confirmed', 'Acknowledged', 'Assigned'].includes(c.status)).length, 'gold'],
    ['In progress', complaints.filter((c) => c.status === 'In Progress').length, 'rose'], ['Resolved', complaints.filter((c) => c.status === 'Resolved').length, 'green'], ['Verified', complaints.filter((c) => c.status === 'Verified').length, 'green'],
  ];
  return <main className="ct-main"><PageHeader eyebrow="Your civic record" title="Good morning, Maya." copy="A clear view of the issues you have raised and the movement that followed." />
    <div className="ct-summary-grid">{stats.map(([label, number, tone]) => <div className={`ct-panel ct-stat ${tone}`} key={label}><div className="ct-stat-label">{label}</div><div className="ct-stat-number">{number}</div></div>)}</div>
    <div className="ct-sidebar-actions" style={{ marginBottom: 23 }}><Link href="/report" className="ct-btn ct-btn-gold" data-testid="link-dashboard-report"><Plus size={14} /> Report new issue</Link><Link href="/track" className="ct-btn ct-btn-ghost" data-testid="link-dashboard-track"><Search size={14} /> Track complaint</Link></div>
     <div className="ct-dash-grid"><section className="ct-panel"><div style={{ padding: '21px 18px 5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2 style={{ fontFamily: 'var(--app-font-serif)', fontSize: 22, margin: 0 }}>Recent complaints</h2><Link href="/track" className="ct-eyebrow" style={{ fontSize: 10 }} data-testid="link-dashboard-view-all">View all <ChevronRight size={12} style={{ verticalAlign: 'middle' }} /></Link></div><div className="ct-list-head"><span>Record</span><span>Location</span><span>Date</span><span>Status</span><span /></div>{complaints.slice(0, 4).map((complaint) => <Link href="/track" className="ct-list-row" key={complaint.id} data-testid={`row-dashboard-${complaint.id}`}><div><div className="ct-id">{complaint.id}</div><div className="ct-row-sub">{complaint.category}</div></div><div className="ct-row-sub">{complaint.location}</div><div className="ct-row-sub">{complaint.date.split(' · ')[0]}</div><span className={statusClass(complaint.status)}>{complaint.status}</span><ChevronRight size={14} color="#967b84" /></Link>)}{!complaints.length && <div className="ct-empty"><ClipboardList size={24} color="#d9b979" /><h3>No on-chain complaints loaded</h3><p>Connect MetaMask on Sepolia to read the CivicTrust record.</p></div>}</section><aside className="ct-panel ct-activity"><h3>Recent activity</h3>{complaints[0]?.updates.slice().reverse().slice(0, 4).map((update) => <div className="ct-activity-item" key={update.timestamp}><div className="ct-activity-icon"><Clock3 size={13} /></div><div><p>{update.action}</p><span>{update.timestamp}</span></div></div>)}{!complaints.length && <p className="ct-muted">Connect a wallet or open the app with MetaMask to read recent authority updates.</p>}<div style={{ marginTop: 19, padding: 14, borderRadius: 10, background: 'rgba(140,190,161,.08)', color: '#a3c7b1', fontSize: 11, lineHeight: 1.45 }}><HeartHandshake size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Your reports help departments see patterns, not just incidents.</div></aside></div>
  </main>;
}

function AuthorityPage({ complaints, onUpdate, notify, isAuthority }: { complaints: Complaint[]; onUpdate: (id: string, patch: { status?: Status; department?: string; update?: string; proofHash?: string }) => Promise<void>; notify: (message: string) => void; isAuthority: boolean }) {
  const [statusFilter, setStatusFilter] = useState('All statuses');
  const [categoryFilter, setCategoryFilter] = useState('All categories');
  const [priorityFilter, setPriorityFilter] = useState('All priorities');
  const [selectedId, setSelectedId] = useState(complaints[0]?.id || '');
  const [nextStatus, setNextStatus] = useState<Status>('Acknowledged');
  const [newUpdate, setNewUpdate] = useState('');
  const [proofHash, setProofHash] = useState('');
  const filtered = complaints.filter((complaint) => (statusFilter === 'All statuses' || complaint.status === statusFilter) && (categoryFilter === 'All categories' || complaint.category === categoryFilter) && (priorityFilter === 'All priorities' || complaint.priority === priorityFilter));
  const selected = complaints.find((complaint) => complaint.id === selectedId);
  useEffect(() => { if (filtered.length && !filtered.some((complaint) => complaint.id === selectedId)) setSelectedId(filtered[0].id); }, [filtered, selectedId]);
  const applyStatus = async (status: Status) => { if (!selected) return; try { await onUpdate(selected.id, { status }); notify(`${selected.id} marked ${status}.`); } catch (error) { notify(getContractErrorMessage(error)); } };
  return <main className="ct-main"><PageHeader eyebrow="For public authorities" title="Operations desk." copy="A focused workspace for triage, assignment, and visible progress. The controls are ready for a future contract connection." />
    <div className="ct-toolbar"><div className="ct-eyebrow"><LayoutDashboard size={14} style={{ verticalAlign: 'middle', marginRight: 7 }} /> {filtered.length} records in view</div><div className="ct-filters"><select className="ct-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} data-testid="select-filter-status">{['All statuses', ...timelineStatuses, 'Pending', 'Confirmed'].map((item) => <option key={item}>{item}</option>)}</select><select className="ct-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} data-testid="select-filter-category">{['All categories', ...Object.keys(departments)].map((item) => <option key={item}>{item}</option>)}</select><select className="ct-select" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} data-testid="select-filter-priority">{['All priorities', 'Urgent', 'High', 'Normal'].map((item) => <option key={item}>{item}</option>)}</select></div></div>
    <div className="ct-authority-layout"><section className="ct-panel ct-table-wrap"><table className="ct-table"><thead><tr><th>Complaint ID</th><th>Category</th><th>Location</th><th>Priority</th><th>Date</th><th>Status</th></tr></thead><tbody>{filtered.map((complaint) => <tr className={selectedId === complaint.id ? 'selected' : ''} key={complaint.id} onClick={() => setSelectedId(complaint.id)} data-testid={`row-authority-${complaint.id}`}><td className="ct-id">{complaint.id}</td><td>{complaint.category}</td><td>{complaint.location}</td><td><span style={{ color: complaint.priority === 'Urgent' ? '#efaaa6' : complaint.priority === 'High' ? '#e3bd74' : '#baa0a5' }}>{complaint.priority}</span></td><td>{complaint.date.split(' · ')[0]}</td><td><span className={statusClass(complaint.status)}>{complaint.status}</span></td></tr>)}</tbody></table>{!filtered.length && <div className="ct-empty"><ClipboardList size={24} color="#d9b979" /><h3>No matching complaints</h3><p>Try widening the filters to see more of the record.</p></div>}</section>
      {selected ? <aside className="ct-panel ct-authority-detail"><div className="ct-eyebrow">Selected record</div><h2>{selected.id}</h2><div className="ct-row-main">{selected.title}</div><div style={{ marginTop: 18 }}><span className={statusClass(selected.status)}>{selected.status}</span></div><div className="ct-meta-grid" style={{ gridTemplateColumns: '1fr 1fr', padding: '19px 0' }}><div><span className="ct-meta-label">Category</span><span className="ct-meta-value">{selected.category}</span></div><div><span className="ct-meta-label">Priority</span><span className="ct-meta-value">{selected.priority}</span></div><div><span className="ct-meta-label">Location</span><span className="ct-meta-value">{selected.location}</span></div><div><span className="ct-meta-label">Department</span><span className="ct-meta-value">{selected.department}</span></div></div><div className="ct-mini-timeline">{selected.updates.slice().reverse().map((update) => <div className="ct-mini-event" key={`${update.status}-${update.timestamp}`}><strong>{update.status}</strong><p>{update.action}<br />{update.timestamp}</p></div>)}</div>
         {!isAuthority && <div className="ct-help" style={{ color: '#efaaa6', marginBottom: 14 }}>Connect the contract authority wallet to use these controls.</div>}
         <div className="ct-control"><label htmlFor="authority-status">Update status</label><div className="ct-control-row"><select id="authority-status" className="ct-select" value={nextStatus} onChange={(e) => setNextStatus(e.target.value as Status)} disabled={!isAuthority} data-testid="select-authority-status">{['Acknowledged', 'In Progress', 'Resolved'].map((item) => <option key={item}>{item}</option>)}</select><button className="ct-btn ct-btn-gold" style={{ padding: '9px 11px' }} onClick={() => void applyStatus(nextStatus)} disabled={!isAuthority} data-testid="button-authority-update-status">Apply</button></div></div>
         <div className="ct-control"><label htmlFor="authority-update">Add update</label><textarea id="authority-update" className="ct-textarea" style={{ minHeight: 70 }} value={newUpdate} onChange={(e) => setNewUpdate(e.target.value)} placeholder="Describe the action taken…" disabled={!isAuthority} data-testid="textarea-authority-update" /><button className="ct-btn ct-btn-soft" style={{ width: '100%', marginTop: 8 }} disabled={!isAuthority} onClick={() => { if (newUpdate.trim()) { void onUpdate(selected.id, { update: newUpdate }).then(() => { setNewUpdate(''); notify('Update added to the public record.'); }).catch((error) => notify(getContractErrorMessage(error))); } }} data-testid="button-authority-add-update"><MessageSquareText size={14} /> Add update</button></div>
         <div className="ct-control"><label htmlFor="authority-proof">Resolution proof</label><div className="ct-control-row"><input id="authority-proof" className="ct-input" value={proofHash} onChange={(e) => setProofHash(e.target.value)} placeholder="IPFS hash or proof URI" disabled={!isAuthority} data-testid="input-authority-proof" /><button className="ct-btn ct-btn-soft" disabled={!isAuthority || !proofHash.trim()} onClick={() => { void onUpdate(selected.id, { proofHash: proofHash.trim() }).then(() => { setProofHash(''); notify('Resolution proof submitted.'); }).catch((error) => notify(getContractErrorMessage(error))); }} data-testid="button-authority-proof">Submit proof</button></div></div>
         <div style={{ display: 'flex', gap: 8, marginTop: 16 }}><button className="ct-btn ct-btn-ghost" style={{ flex: 1, padding: '10px 7px', fontSize: 11 }} disabled={!isAuthority} onClick={() => { void onUpdate(selected.id, { department: 'Field Response Unit', status: 'Assigned' }).then(() => notify('Complaint assigned to Field Response Unit.')).catch((error) => notify(getContractErrorMessage(error))); }} data-testid="button-authority-assign"><Link2 size={13} /> Assign</button><button className="ct-btn ct-btn-gold" style={{ flex: 1, padding: '10px 7px', fontSize: 11 }} disabled={!isAuthority} onClick={() => void applyStatus('Resolved')} data-testid="button-authority-resolve"><FileCheck2 size={13} /> Mark resolved</button></div>
      </aside> : <div className="ct-panel ct-empty"><ClipboardList size={24} /><h3>Select a complaint</h3></div>}</div>
  </main>;
}

function Router({ complaints, onCreate, onUpdate, onLoadComplaint, onVerify, onChallenge, notify, isAuthority }: { complaints: Complaint[]; onCreate: (input: { title: string; category: string; description: string; location: string; priority: string; file: string }) => Promise<Complaint>; onUpdate: (id: string, patch: { status?: Status; department?: string; update?: string; proofHash?: string }) => Promise<void>; onLoadComplaint: (complaintId: bigint) => Promise<Complaint>; onVerify: (complaintId: bigint) => Promise<void>; onChallenge: (complaintId: bigint, reason: string) => Promise<void>; notify: (message: string) => void; isAuthority: boolean }) {
  return <ErrorBoundary resetKey={useLocation()[0]}><Switch><Route path="/" component={HomePage} /><Route path="/report"><ReportPage onCreate={onCreate} notify={notify} /></Route><Route path="/track"><TrackPage complaints={complaints} onLoadComplaint={onLoadComplaint} onVerify={onVerify} onChallenge={onChallenge} notify={notify} /></Route><Route path="/dashboard"><DashboardPage complaints={complaints} /></Route><Route path="/authority"><AuthorityPage complaints={complaints} onUpdate={onUpdate} notify={notify} isAuthority={isAuthority} /></Route><Route component={NotFound} /></Switch></ErrorBoundary>;
}

function App() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [wallet, setWallet] = useState('');
  const [isAuthority, setIsAuthority] = useState(false);
  const [toast, setToast] = useState('');
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3600); };
  const replaceComplaint = (onChainComplaint: OnChainComplaint, transactionHash?: string) => {
    const complaint = { ...onChainComplaintToUi(onChainComplaint), transactionHash };
    setComplaints((current) => [complaint, ...current.filter((item) => item.contractId !== complaint.contractId)]);
    return complaint;
  };
  const refreshComplaints = async (showError = false) => {
    try {
      const onChainComplaints = await readAllComplaints();
      setComplaints(onChainComplaints.map((complaint) => onChainComplaintToUi(complaint)));
    } catch (error) {
      if (showError) notify(getContractErrorMessage(error));
    }
  };
  const refreshComplaint = async (complaintId: bigint) => {
    const refreshed = await readComplaint(complaintId);
    return replaceComplaint(refreshed);
  };
  const connectWallet = async () => {
    try {
      const connected = await connectContractWallet();
      setWallet(connected.address);
      setIsAuthority(connected.isAuthority);
      await refreshComplaints(true);
      notify(connected.isAuthority ? 'Authority wallet connected on Sepolia.' : 'Wallet connected on Sepolia.');
    } catch (error) {
      notify(getContractErrorMessage(error));
    }
  };
  const createComplaint = async (input: { title: string; category: string; description: string; location: string; priority: string; file: string }) => {
    const created = await createOnChainComplaint({
      title: input.title,
      issueType: input.category,
      description: input.description,
      location: input.location,
      evidenceHash: input.file,
      priority: input.priority,
    });
    const onChainComplaint = await readComplaint(created.complaintId);
    return replaceComplaint(onChainComplaint, created.transactionHash);
  };
  const updateComplaint = async (id: string, patch: { status?: Status; department?: string; update?: string; proofHash?: string }) => {
    const complaint = complaints.find((item) => item.id === id);
    if (!complaint?.contractId) throw new Error('Select an on-chain complaint first.');
    if (patch.department) await writeContract('assignComplaint', [complaint.contractId, patch.department]);
    if (patch.status === 'Acknowledged') await writeContract('startReview', [complaint.contractId]);
    if (patch.status === 'In Progress') await writeContract('startWork', [complaint.contractId]);
    if (patch.status === 'Resolved') await writeContract('markResolved', [complaint.contractId]);
    if (patch.update) await writeContract('addAuthorityUpdate', [complaint.contractId, patch.update]);
    if (patch.proofHash) await writeContract('submitResolutionProof', [complaint.contractId, patch.proofHash]);
    await refreshComplaint(complaint.contractId);
  };
  const verifyComplaint = async (complaintId: bigint) => {
    await writeContract('confirmResolution', [complaintId]);
    await refreshComplaint(complaintId);
  };
  const challengeComplaint = async (complaintId: bigint, reason: string) => {
    await writeContract('challengeResolution', [complaintId, reason]);
    await refreshComplaint(complaintId);
  };
  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum) return;
    const handleAccountsChanged = async (...args: unknown[]) => {
      const accounts = (args[0] || []) as string[];
      const address = accounts[0];
      if (!address) {
        setWallet('');
        setIsAuthority(false);
        setComplaints([]);
        return;
      }
      setWallet(address);
      try {
        setIsAuthority(await readIsAdmin(address));
        await refreshComplaints(false);
      } catch {
        setIsAuthority(false);
      }
    };
    const handleChainChanged = () => {
      setWallet('');
      setIsAuthority(false);
      setComplaints([]);
      notify('Network changed. Switch MetaMask back to Ethereum Sepolia to continue.');
    };
    void refreshComplaints(false);
    ethereum.on?.('accountsChanged', handleAccountsChanged);
    ethereum.on?.('chainChanged', handleChainChanged);
    return () => {
      ethereum.removeListener?.('accountsChanged', handleAccountsChanged);
      ethereum.removeListener?.('chainChanged', handleChainChanged);
    };
  }, []);
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AppShell wallet={wallet} onConnect={connectWallet}><Router complaints={complaints} onCreate={createComplaint} onUpdate={updateComplaint} onLoadComplaint={async (complaintId) => replaceComplaint(await readComplaint(complaintId))} onVerify={verifyComplaint} onChallenge={challengeComplaint} notify={notify} isAuthority={isAuthority} /></AppShell></WouterRouter></TooltipProvider><Toaster />{toast && <div className="ct-toast" data-testid="status-toast">{toast}</div>}</QueryClientProvider>;
}

export default App;