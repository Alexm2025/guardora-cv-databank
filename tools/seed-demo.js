'use strict';

/*
 * Fills a SEPARATE demo databank with realistic, made-up CVs so you can try every feature safely.
 *   DATA_DIR=demo-data node tools/seed-demo.js [count]
 * Refuses to run on the real data folder.
 */

const path = require('node:path');

if (!process.env.DATA_DIR || path.resolve(process.env.DATA_DIR) === path.resolve(__dirname, '..', 'data')) {
  console.error('Run this with DATA_DIR pointing at a demo folder, e.g.  DATA_DIR=demo-data node tools/seed-demo.js');
  process.exit(1);
}
process.env.DISABLE_SOURCES = '1';

const { ingestFile } = require('../server/ingest');
const { run, get } = require('../server/db');
const { makePdf, makeDocx } = require('../tests/fixtures');

let seed = 20261108;
const rnd = () => { // mulberry32: small, repeatable, good enough for demo data
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const some = (a, n) => [...a].sort(() => rnd() - 0.5).slice(0, n);
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const FIRST_F = ['Priya', 'Sneha', 'Pooja', 'Anjali', 'Neha', 'Kavya', 'Shruti', 'Riya', 'Aishwarya', 'Divya', 'Meera', 'Tanvi', 'Ishita', 'Nikita', 'Sakshi', 'Prachi', 'Asha', 'Fatima', 'Sana', 'Deepika'];
const FIRST_M = ['Rahul', 'Amit', 'Rohan', 'Vikram', 'Suresh', 'Arjun', 'Karan', 'Nikhil', 'Siddharth', 'Aditya', 'Manoj', 'Imran', 'Sandeep', 'Pranav', 'Yash', 'Omkar', 'Tejas', 'Harsh', 'Abhishek', 'Ganesh'];
const LAST = ['Sharma', 'Patil', 'Deshmukh', 'Iyer', 'Nair', 'Kulkarni', 'Joshi', 'Gupta', 'Verma', 'Shaikh', 'Pawar', 'Reddy', 'Menon', 'Mehta', 'Shah', 'Jadhav', 'Singh', 'Chavan', 'Pillai', 'Banerjee', 'Kamble', 'Rao', 'Desai', 'More'];
const CITIES = [['Thane', 'Maharashtra'], ['Mumbai', 'Maharashtra'], ['Navi Mumbai', 'Maharashtra'], ['Pune', 'Maharashtra'], ['Kalyan', 'Maharashtra'], ['Nashik', 'Maharashtra'],
  ['Bengaluru', 'Karnataka'], ['Hyderabad', 'Telangana'], ['Ahmedabad', 'Gujarat'], ['Delhi', 'Delhi'], ['Gurugram', 'Haryana'], ['Chennai', 'Tamil Nadu'], ['Nagpur', 'Maharashtra'], ['Indore', 'Madhya Pradesh']];
// Real localities, so the area and railway-line filters have something to show.
const LOCALITIES = {
  Mumbai: ['Mulund', 'Bhandup', 'Vikhroli', 'Ghatkopar', 'Kurla', 'Chembur', 'Powai', 'Andheri', 'Goregaon', 'Malad', 'Kandivali', 'Borivali', 'Dadar', 'Sion', 'Wadala', 'Bandra', 'Govandi'],
  Thane: ['Kalwa', 'Mumbra', 'Ghodbunder Road', 'Majiwada', 'Wagle Estate', 'Naupada'],
  'Navi Mumbai': ['Vashi', 'Nerul', 'Kharghar', 'Airoli', 'Ghansoli', 'Kopar Khairane', 'Belapur', 'Sanpada', 'Ulwe'],
  Kalyan: ['Kalyan', 'Dombivli', 'Thakurli', 'Titwala'],
  Pune: ['Hinjewadi', 'Wakad', 'Baner', 'Kothrud', 'Hadapsar', 'Viman Nagar']
};

const ROLES = {
  accounts: { titles: ['Accounts Executive', 'Senior Accountant', 'Accounts Assistant', 'Finance Executive'], skills: ['Tally Prime', 'GST', 'TDS', 'Advanced Excel', 'Accounts Payable', 'Bank Reconciliation', 'SAP FICO', 'Payroll', 'MIS Reporting', 'Zoho Books', 'VLOOKUP'], degrees: [['B.Com', 'M.Com', 'MBA (Finance)'], ['B.Com'], ['BAF', 'M.Com']] },
  hr: { titles: ['HR Executive', 'Talent Acquisition Specialist', 'HR Generalist', 'Recruiter'], skills: ['Recruitment', 'Onboarding', 'Payroll', 'Employee Engagement', 'Naukri', 'Statutory Compliance', 'HRMS', 'Bulk Hiring', 'MS Excel'], degrees: [['BBA', 'MBA (HR)'], ['B.A.', 'MSW'], ['B.Com', 'PGDM']] },
  sales: { titles: ['Sales Executive', 'Business Development Executive', 'Area Sales Manager', 'Relationship Manager'], skills: ['B2B Sales', 'Lead Generation', 'Field Sales', 'Negotiation', 'CRM', 'Key Account Management', 'Channel Sales', 'Cold Calling'], degrees: [['BBA'], ['B.Com', 'MBA (Marketing)'], ['B.Sc']] },
  it: { titles: ['Software Developer', 'Full Stack Developer', 'QA Engineer', 'Data Analyst'], skills: ['Java', 'Spring Boot', 'React', 'Node.js', 'SQL', 'Python', 'AWS', 'Selenium', 'Power BI', 'Git', 'Docker', 'REST API'], degrees: [['B.E.'], ['B.Tech', 'M.Tech'], ['BCA', 'MCA'], ['B.Sc', 'MCA']] },
  ops: { titles: ['Operations Executive', 'Logistics Coordinator', 'Purchase Executive', 'Store Keeper'], skills: ['Supply Chain', 'Procurement', 'Vendor Management', 'Inventory Control', 'Dispatch', 'SAP MM', 'MS Excel', 'Warehouse Management'], degrees: [['B.Com'], ['BBA', 'PGDM'], ['Diploma']] },
  support: { titles: ['Customer Support Executive', 'Front Office Executive', 'Back Office Executive', 'Telecaller'], skills: ['Customer Service', 'Voice Process', 'Email Support', 'Data Entry', 'MS Office', 'Complaint Handling', 'CRM'], degrees: [['HSC'], ['B.A.'], ['B.Com']] }
};
const COMPANIES = ['Mahindra Logistics Ltd', 'Tata Consultancy Services Ltd', 'Reliance Retail Ltd', 'Bajaj Finance Ltd', 'HDFC Bank Ltd', 'Asian Paints Ltd', 'Godrej Industries Ltd',
  'Larsen & Toubro Ltd', 'Infosys BPM Ltd', 'Wipro Technologies Ltd', 'Shree Ganesh Traders Pvt Ltd', 'Om Sai Enterprises', 'Kotak Mahindra Bank Ltd', 'Blue Dart Express Ltd', 'Zydus Pharmaceuticals Ltd',
  'Capgemini Technology Services Pvt Ltd', 'Hexaware Technologies Ltd', 'Tech Mahindra Ltd', 'Vibrant Solutions Pvt Ltd', 'Sai Krupa Associates'];
const COLLEGES = ['University of Mumbai', 'Savitribai Phule Pune University', 'K.V. Pendharkar College, Dombivli', 'Symbiosis College, Pune', 'Mithibai College, Mumbai', 'VJTI, Mumbai',
  'Osmania University', 'Bangalore University', 'Gujarat University', 'Delhi University', 'Anna University', 'RTM Nagpur University', 'DAVV Indore'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function person(i) {
  const female = rnd() < 0.48;
  const first = pick(female ? FIRST_F : FIRST_M);
  const last = pick(LAST);
  const [city, state] = pick(CITIES);
  const domain = pick(Object.keys(ROLES));
  const role = ROLES[domain];
  const birthYear = int(1978, 2001);
  const gradYear = birthYear + int(20, 23);
  const degrees = pick(role.degrees);
  const jobs = [];
  const companies = some(COMPANIES, 4);
  let start = gradYear * 12 + int(5, 8);
  const now = 2026 * 12 + 9;
  while (start < now - 6 && jobs.length < 4) {
    const len = int(10, 50);
    const end = Math.min(start + len, now);
    jobs.push({ company: companies[jobs.length], title: pick(role.titles), start, end: end >= now - 1 ? null : end, duty: some(['invoices', 'reports', 'vendor follow-ups', 'client calls', 'month-end closing', 'team coordination'], 2).join(' and ') });
    start = end + int(0, 3);
  }
  return {
    i, female, name: first + ' ' + last, city, state, domain, role, birthYear, gradYear, degrees, jobs,
    // Safe to show publicly: .test is a reserved domain, and 07700 900xxx is the UK range reserved for fiction.
    email: (first + '.' + last + (i > 20 ? i : '')).toLowerCase() + '@mail.test',
    phone: '7700900' + String(i % 1000).padStart(3, '0'),
    skills: some(role.skills, int(4, 8)), score: int(55, 88),
    colleges: degrees.map(() => pick(COLLEGES)), hsc: int(55, 85), dob: [int(1, 28), int(1, 12)],
    address: int(1, 400) + ', ' + pick(['Shanti Nagar', 'Gandhi Road', 'Station Road', 'Lake View CHS', 'Sai Krupa CHS']) + ', ' + (LOCALITIES[city] ? pick(LOCALITIES[city]) + ' ' + pick(['East', 'West', '']) + ', ' : '') + city + ' - ' + int(400001, 499999) + ', ' + state,
    notice: pick(['Immediate', '15 days', '30 days', '60 days', '90 days'])
  };
}

const m = (idx) => MONTHS[idx % 12] + ' ' + Math.floor(idx / 12);

function cvLines(p, { upTo = null, tweak = {} } = {}) {
  const jobs = p.jobs.filter((j) => upTo == null || j.start < upTo).map((j) => ({ ...j, end: upTo != null && (j.end == null || j.end > upTo) ? null : j.end }));
  if (tweak.extraJob) jobs.unshift(tweak.extraJob);
  const totalMonths = jobs.reduce((s, j) => s + ((j.end ?? (upTo || 2026 * 12 + 9)) - j.start), 0);
  const years = tweak.claimYears ?? Math.round(totalMonths / 12);
  const lines = [p.name.toUpperCase(), 'Email: ' + p.email + ' | Mobile: +44 ' + p.phone.slice(0, 4) + ' ' + p.phone.slice(4),
    'Address: ' + p.address, '',
    'Profile Summary', (years ? p.role.titles[0] + ' with ' + years + ' years of experience' : 'Fresher') + ' in ' + p.skills.slice(0, 3).join(', ') + '.', '',
    'Work Experience'];
  for (const j of jobs.slice().reverse().sort((a, b) => b.start - a.start)) {
    lines.push(j.title + ' - ' + j.company + '     ' + m(j.start) + ' - ' + (j.end == null ? 'Present' : m(j.end)));
    lines.push('Responsible for ' + (j.duty || 'daily operations') + '.');
  }
  lines.push('', 'Educational Qualifications');
  p.degrees.slice().reverse().forEach((d, k) => {
    const year = (tweak.gradYear ?? p.gradYear) + (p.degrees.length - 1 - k) * 2;
    lines.push(d + ' - ' + p.colleges[p.degrees.length - 1 - k] + ' - ' + year + ' - ' + (p.score - k * 3) + '%');
  });
  lines.push('HSC - Maharashtra Board - ' + (p.gradYear - 3) + ' - ' + p.hsc + '%', '',
    'Key Skills', p.skills.join(', '), '', 'Personal Details',
    'Date of Birth: ' + String(p.dob[0]).padStart(2, '0') + '/' + String(p.dob[1]).padStart(2, '0') + '/' + (tweak.birthYear ?? p.birthYear),
    'Gender: ' + (p.female ? 'Female' : 'Male'), 'Languages Known: English, Hindi' + (p.state === 'Maharashtra' ? ', Marathi' : ''),
    'Notice Period: ' + p.notice,
    'Declaration: I hereby declare that the information given above is true.');
  return lines;
}

async function main() {
  const count = Number(process.argv[2]) || 150;
  const people = Array.from({ length: count }, (_, i) => person(i));
  let n = 0;
  for (const p of people) {
    const firstAt = new Date(Date.UTC(2026, 9, 31) - int(1, 1500) * 864e5);
    const firstIdx = firstAt.getUTCFullYear() * 12 + firstAt.getUTCMonth();
    const src = pick(['email', 'email', 'email', 'website', 'upload']);
    const make = rnd() < 0.7 ? makePdf : makeDocx;
    const ext = make === makePdf ? '.pdf' : '.docx';
    const v1 = await ingestFile({
      buffer: make(cvLines(p, { upTo: firstIdx })), fileName: p.name.replace(' ', '_') + '_CV' + ext, source: src, ref: 'demo:' + p.i + ':1', trusted: true,
      receivedAt: firstAt.toISOString(), sender: p.email, subject: 'Application for ' + p.role.titles[0], jobTitle: src === 'website' ? p.role.titles[0] : ''
    });
    n++;
    // About a third come back later with an updated CV; some rewrite their history.
    if (rnd() < 0.35) {
      const laterAt = new Date(Math.min(Date.parse('2026-11-05'), firstAt.getTime() + int(90, 900) * 864e5));
      const fraud = rnd() < 0.35;
      const tweak = fraud ? pick([
        { birthYear: p.birthYear - 3 },
        { gradYear: p.gradYear - 2 },
        { claimYears: Math.round((laterAt.getUTCFullYear() - p.gradYear) + 5) },
        { extraJob: { company: COMPANIES.find((c) => !p.jobs.some((j) => j.company === c)), title: pick(p.role.titles), start: (p.gradYear - 2) * 12, end: (p.gradYear) * 12 } }
      ]) : {};
      await ingestFile({
        buffer: makePdf(cvLines(p, { upTo: laterAt.getUTCFullYear() * 12 + laterAt.getUTCMonth(), tweak })), fileName: p.name + ' Resume Updated.pdf', source: 'email',
        ref: 'demo:' + p.i + ':2', trusted: true, receivedAt: laterAt.toISOString(), sender: p.email, subject: 'Updated resume - ' + p.name
      });
      n++;
    }
    if (rnd() < 0.15 && v1.candidateId) run("UPDATE candidates SET done = 1, done_at = ?, status = 'placed' WHERE id = ?", new Date(Date.parse(firstAt) + 20 * 864e5).toISOString(), v1.candidateId);
    else if (rnd() < 0.25 && v1.candidateId) run('UPDATE candidates SET status = ? WHERE id = ?', pick(['reviewing', 'shortlisted', 'interview', 'on_hold']), v1.candidateId);
    if (rnd() < 0.12 && v1.candidateId) run('UPDATE candidates SET starred = 1, rating = ? WHERE id = ?', int(3, 5), v1.candidateId);
  }
  const bl = get('SELECT id FROM candidates ORDER BY id LIMIT 1 OFFSET 7');
  if (bl) run("UPDATE candidates SET blacklisted = 1, blacklist_reason = 'Submitted a fake experience letter to a client (Mar 2025)', blacklisted_at = ? WHERE id = ?", new Date().toISOString(), bl.id);
  console.log('Demo databank ready: ' + get('SELECT COUNT(*) AS n FROM candidates').n + ' candidates, ' + n + ' CVs, ' +
    get('SELECT COUNT(*) AS n FROM flags').n + ' alerts, ' + get("SELECT COUNT(*) AS n FROM duplicate_suggestions WHERE status = 'open'").n + ' possible duplicates.');
}

main().catch((err) => { console.error(err); process.exit(1); });
