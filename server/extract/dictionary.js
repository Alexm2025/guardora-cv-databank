'use strict';

/* Reference lists used to read CVs: education levels, degrees, Indian cities/states, and skills. */

const EDUCATION_LEVELS = [
  { level: 0, label: 'Unknown' },
  { level: 1, label: 'Below 10th' },
  { level: 2, label: '10th / SSC' },
  { level: 3, label: '12th / HSC' },
  { level: 4, label: 'Diploma / ITI' },
  { level: 5, label: 'Graduate' },
  { level: 6, label: 'Professional (CA/CS/CMA)' },
  { level: 7, label: 'Post-graduate' },
  { level: 8, label: 'Doctorate' }
];

// [display name, level, pattern]. Order matters: longer / more specific forms first.
const DEGREES = [
  ['Ph.D', 8, /\b(ph\.?\s?d|doctorate|doctor of philosophy)\b/i],
  ['MBA', 7, /\b(m\.?\s?b\.?\s?a|master of business administration|executive mba)\b/i],
  ['PGDM', 7, /\b(p\.?\s?g\.?\s?d\.?\s?m|pgdbm|post ?graduate diploma in (business )?management)\b/i],
  ['PG Diploma', 7, /\b(p\.?\s?g\.?\s?diploma|pgd[a-z]{0,3}|post ?graduate diploma)\b/i],
  ['M.Tech', 7, /\b(m\.?\s?tech|master of technology)\b/i],
  ['M.E.', 7, /\b(m\.\s?e\.|master of engineering)/i],
  ['MCA', 7, /\b(m\.?\s?c\.?\s?a|master of computer applications?)\b/i],
  ['M.Com', 7, /\b(m\.?\s?com|master of commerce)\b/i],
  ['M.Sc', 7, /\b(m\.?\s?sc|master of science)\b/i],
  ['M.A.', 7, /\b(m\.\s?a\.|master of arts)\b|\bM\.?A\.? \(?(english|economics|history|psychology|sociology|political|hindi|marathi)/i],
  ['MSW', 7, /\b(m\.?\s?s\.?\s?w|master of social work)\b/i],
  ['M.Pharm', 7, /\bm\.?\s?pharm/i],
  ['LLM', 7, /\b(ll\.?\s?m|master of laws?)\b/i],
  ['M.Ed', 7, /\bm\.?\s?ed\b/i],
  ['MD/MS', 7, /\b(m\.d\.|doctor of medicine)\b/i],
  ['CA', 6, /\b(chartered accountant|c\.a\.\s?(final|inter|intermediate)?|ca final|ca inter(mediate)?|\bACA\b|\bFCA\b)/i],
  ['CS', 6, /\b(company secretary|cs (executive|professional|final))\b/i],
  ['CMA', 6, /\b(cma|icwa|icwai|cost (and|&) management accountant)\b/i],
  ['CFA', 6, /\bcfa\b/i],
  ['ACCA', 6, /\bacca\b/i],
  ['B.Tech', 5, /\b(b\.?\s?tech|bachelor of technology)\b/i],
  ['B.E.', 5, /\b(b\.\s?e\.?|bachelor of engineering)(?![a-z])/i],
  ['BCA', 5, /\b(b\.?\s?c\.?\s?a|bachelor of computer applications?)\b/i],
  ['BBA', 5, /\b(b\.?\s?b\.?\s?a|bachelor of business administration)\b/i],
  ['BMS', 5, /\b(b\.?\s?m\.?\s?s|bachelor of management studies)\b/i],
  ['BBM', 5, /\bb\.?\s?b\.?\s?m\b/i],
  ['BAF', 5, /\b(b\.?\s?a\.?\s?f|bachelor of accounting (and|&) finance)\b/i],
  ['BBI', 5, /\b(b\.?\s?b\.?\s?i|bachelor of banking (and|&) insurance)\b/i],
  ['B.Com', 5, /\b(b\.?\s?com|bachelor of commerce)\b/i],
  ['B.Sc', 5, /\b(b\.?\s?sc|bachelor of science)\b/i],
  ['B.Pharm', 5, /\bb\.?\s?pharm/i],
  ['B.Arch', 5, /\bb\.?\s?arch\b/i],
  ['LLB', 5, /\b(ll\.?\s?b|bachelor of laws?)\b/i],
  ['MBBS', 5, /\bm\.?\s?b\.?\s?b\.?\s?s\b/i],
  ['BDS', 5, /\bb\.?\s?d\.?\s?s\b/i],
  ['BHMS/BAMS', 5, /\b(bhms|bams)\b/i],
  ['B.Ed', 5, /\bb\.?\s?ed\b/i],
  ['BHM', 5, /\b(bhm|bhmct|hotel management)\b/i],
  ['B.Voc', 5, /\bb\.?\s?voc\b/i],
  ['B.A.', 5, /\b(b\.\s?a\.|bachelor of arts)|\bB\.?A\.? \(?(english|economics|history|psychology|sociology|political|hindi|marathi)/i],
  ['Graduate', 5, /\b(graduat(e|ion) (in|from)|bachelor'?s degree)\b/i],
  ['Diploma', 4, /\b(diploma|polytechnic|d\.?\s?pharm|gnm|anm)\b/i],
  ['ITI', 4, /\b(i\.?\s?t\.?\s?i|industrial training institute)\b/i],
  ['12th / HSC', 3, /\b(h\.?\s?s\.?\s?c|12th|xii(th)?|higher secondary|intermediate|senior secondary|class 12|puc|pre[- ]university)\b/i],
  ['10th / SSC', 2, /\b(s\.?\s?s\.?\s?c|10th|x(th)?\b(?! ?ray)|matriculation|secondary school certificate|class 10|s\.?\s?s\.?\s?l\.?\s?c)\b/i]
];

// city -> state. Covers India's larger cities and the industrial / IT hubs where most applicants live.
const CITIES = {
  Mumbai: 'Maharashtra', 'Navi Mumbai': 'Maharashtra', Thane: 'Maharashtra', Pune: 'Maharashtra', Nagpur: 'Maharashtra',
  Nashik: 'Maharashtra', Aurangabad: 'Maharashtra', 'Chhatrapati Sambhajinagar': 'Maharashtra', Kolhapur: 'Maharashtra',
  Solapur: 'Maharashtra', Amravati: 'Maharashtra', Kalyan: 'Maharashtra', Dombivli: 'Maharashtra', 'Vasai': 'Maharashtra',
  Virar: 'Maharashtra', Bhiwandi: 'Maharashtra', Panvel: 'Maharashtra', 'Mira Road': 'Maharashtra', Ulhasnagar: 'Maharashtra',
  Sangli: 'Maharashtra', Satara: 'Maharashtra', Jalgaon: 'Maharashtra', Akola: 'Maharashtra', Latur: 'Maharashtra',
  Ahmednagar: 'Maharashtra', Nanded: 'Maharashtra', Ratnagiri: 'Maharashtra', Chakan: 'Maharashtra', Pimpri: 'Maharashtra',
  Chinchwad: 'Maharashtra', Hinjewadi: 'Maharashtra', Palghar: 'Maharashtra', Boisar: 'Maharashtra', Raigad: 'Maharashtra',
  Delhi: 'Delhi', 'New Delhi': 'Delhi', Noida: 'Uttar Pradesh', 'Greater Noida': 'Uttar Pradesh', Ghaziabad: 'Uttar Pradesh',
  Gurugram: 'Haryana', Gurgaon: 'Haryana', Faridabad: 'Haryana', Panipat: 'Haryana', Sonipat: 'Haryana', Ambala: 'Haryana',
  Karnal: 'Haryana', Hisar: 'Haryana', Rohtak: 'Haryana', Manesar: 'Haryana',
  Bengaluru: 'Karnataka', Bangalore: 'Karnataka', Mysuru: 'Karnataka', Mysore: 'Karnataka', Mangaluru: 'Karnataka',
  Mangalore: 'Karnataka', Hubli: 'Karnataka', Dharwad: 'Karnataka', Belgaum: 'Karnataka', Belagavi: 'Karnataka',
  Hyderabad: 'Telangana', Secunderabad: 'Telangana', Warangal: 'Telangana',
  Chennai: 'Tamil Nadu', Coimbatore: 'Tamil Nadu', Madurai: 'Tamil Nadu', Tiruchirappalli: 'Tamil Nadu', Trichy: 'Tamil Nadu',
  Salem: 'Tamil Nadu', Tiruppur: 'Tamil Nadu', Hosur: 'Tamil Nadu', Vellore: 'Tamil Nadu', Erode: 'Tamil Nadu',
  Kolkata: 'West Bengal', Howrah: 'West Bengal', Durgapur: 'West Bengal', Asansol: 'West Bengal', Siliguri: 'West Bengal',
  Ahmedabad: 'Gujarat', Surat: 'Gujarat', Vadodara: 'Gujarat', Baroda: 'Gujarat', Rajkot: 'Gujarat', Gandhinagar: 'Gujarat',
  Bhavnagar: 'Gujarat', Jamnagar: 'Gujarat', Vapi: 'Gujarat', Anand: 'Gujarat', Bharuch: 'Gujarat', Ankleshwar: 'Gujarat',
  Jaipur: 'Rajasthan', Jodhpur: 'Rajasthan', Udaipur: 'Rajasthan', Kota: 'Rajasthan', Ajmer: 'Rajasthan', Bikaner: 'Rajasthan',
  Lucknow: 'Uttar Pradesh', Kanpur: 'Uttar Pradesh', Agra: 'Uttar Pradesh', Varanasi: 'Uttar Pradesh', Prayagraj: 'Uttar Pradesh',
  Allahabad: 'Uttar Pradesh', Meerut: 'Uttar Pradesh', Bareilly: 'Uttar Pradesh', Aligarh: 'Uttar Pradesh', Gorakhpur: 'Uttar Pradesh',
  Indore: 'Madhya Pradesh', Bhopal: 'Madhya Pradesh', Jabalpur: 'Madhya Pradesh', Gwalior: 'Madhya Pradesh', Ujjain: 'Madhya Pradesh',
  Pithampur: 'Madhya Pradesh',
  Patna: 'Bihar', Gaya: 'Bihar', Muzaffarpur: 'Bihar', Bhagalpur: 'Bihar',
  Ranchi: 'Jharkhand', Jamshedpur: 'Jharkhand', Dhanbad: 'Jharkhand', Bokaro: 'Jharkhand',
  Bhubaneswar: 'Odisha', Cuttack: 'Odisha', Rourkela: 'Odisha',
  Raipur: 'Chhattisgarh', Bhilai: 'Chhattisgarh', Bilaspur: 'Chhattisgarh',
  Kochi: 'Kerala', Cochin: 'Kerala', Ernakulam: 'Kerala', Thiruvananthapuram: 'Kerala', Trivandrum: 'Kerala',
  Kozhikode: 'Kerala', Calicut: 'Kerala', Thrissur: 'Kerala', Kollam: 'Kerala',
  Visakhapatnam: 'Andhra Pradesh', Vizag: 'Andhra Pradesh', Vijayawada: 'Andhra Pradesh', Guntur: 'Andhra Pradesh',
  Tirupati: 'Andhra Pradesh', Nellore: 'Andhra Pradesh',
  Chandigarh: 'Chandigarh', Mohali: 'Punjab', Ludhiana: 'Punjab', Amritsar: 'Punjab', Jalandhar: 'Punjab', Patiala: 'Punjab',
  Dehradun: 'Uttarakhand', Haridwar: 'Uttarakhand', Rudrapur: 'Uttarakhand',
  Guwahati: 'Assam', Shimla: 'Himachal Pradesh', Baddi: 'Himachal Pradesh', Jammu: 'Jammu and Kashmir', Srinagar: 'Jammu and Kashmir',
  Goa: 'Goa', Panaji: 'Goa', Margao: 'Goa', Vasco: 'Goa', Puducherry: 'Puducherry', Pondicherry: 'Puducherry',
  Silvassa: 'Dadra and Nagar Haveli and Daman and Diu', Daman: 'Dadra and Nagar Haveli and Daman and Diu',
  Dubai: 'UAE (abroad)', 'Abu Dhabi': 'UAE (abroad)', Sharjah: 'UAE (abroad)', Doha: 'Qatar (abroad)', Riyadh: 'Saudi Arabia (abroad)',
  Muscat: 'Oman (abroad)', Singapore: 'Singapore (abroad)', London: 'UK (abroad)'
};

// Spelling variants -> the name shown in filters.
const CITY_ALIASES = {
  Bangalore: 'Bengaluru', Gurgaon: 'Gurugram', Mysore: 'Mysuru', Mangalore: 'Mangaluru', Belgaum: 'Belagavi', Baroda: 'Vadodara',
  Allahabad: 'Prayagraj', Cochin: 'Kochi', Ernakulam: 'Kochi', Trivandrum: 'Thiruvananthapuram', Calicut: 'Kozhikode',
  Vizag: 'Visakhapatnam', Trichy: 'Tiruchirappalli', Pondicherry: 'Puducherry', 'Chhatrapati Sambhajinagar': 'Aurangabad',
  'New Delhi': 'Delhi', Bombay: 'Mumbai', Madras: 'Chennai', Calcutta: 'Kolkata', Poona: 'Pune', Pimpri: 'Pune', Chinchwad: 'Pune',
  Hinjewadi: 'Pune', Chakan: 'Pune', Secunderabad: 'Hyderabad', Panaji: 'Goa', Margao: 'Goa', Vasco: 'Goa'
};

const STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh'
];

// Skills, grouped only to keep this list readable. Matching is whole-word and case-insensitive.
const SKILL_GROUPS = {
  accounts: ['Tally', 'Tally ERP 9', 'Tally Prime', 'Busy', 'Marg ERP', 'Zoho Books', 'QuickBooks', 'Xero', 'GST', 'GST Returns', 'TDS', 'Income Tax',
    'ITR Filing', 'Accounts Payable', 'Accounts Receivable', 'General Ledger', 'Bank Reconciliation', 'BRS', 'Reconciliation', 'Bookkeeping',
    'Book Keeping', 'Finalisation of Accounts', 'Balance Sheet', 'P&L', 'MIS', 'MIS Reporting', 'Budgeting', 'Forecasting', 'Costing',
    'Cost Accounting', 'Audit', 'Internal Audit', 'Statutory Audit', 'Taxation', 'Direct Tax', 'Indirect Tax', 'Payroll', 'Invoicing',
    'Vendor Payments', 'Petty Cash', 'Cash Flow', 'Fixed Assets', 'Inventory Management', 'Stock Audit', 'Financial Analysis',
    'Financial Reporting', 'Ind AS', 'IFRS', 'Treasury', 'Credit Control', 'Collections', 'E-way Bill', 'TCS', 'PF', 'ESIC', 'Professional Tax',
    'ROC Filing', 'Compliance', 'FP&A', 'Month End Closing', 'Consolidation', 'Transfer Pricing'],
  erp: ['SAP', 'SAP FICO', 'SAP MM', 'SAP SD', 'SAP HCM', 'SAP PP', 'SAP ABAP', 'SAP S/4HANA', 'Oracle ERP', 'Oracle Financials', 'Microsoft Dynamics',
    'Navision', 'NetSuite', 'Odoo', 'ERPNext', 'Salesforce', 'Zoho CRM', 'HubSpot', 'Workday', 'SuccessFactors', 'Darwinbox', 'Keka', 'greytHR'],
  office: ['MS Office', 'MS Excel', 'Excel', 'Advanced Excel', 'VLOOKUP', 'HLOOKUP', 'XLOOKUP', 'Pivot Tables', 'Macros', 'VBA', 'MS Word',
    'PowerPoint', 'MS Access', 'Google Sheets', 'Outlook', 'Data Entry', 'Typing', 'Documentation', 'Power Query'],
  hr: ['Recruitment', 'Talent Acquisition', 'Sourcing', 'Screening', 'Onboarding', 'Induction', 'Employee Engagement', 'Employee Relations',
    'Performance Management', 'Compensation', 'Benefits', 'HRMS', 'HRIS', 'Training and Development', 'L&D', 'Statutory Compliance',
    'Labour Laws', 'Exit Interviews', 'Attendance Management', 'Leave Management', 'Bulk Hiring', 'Campus Hiring', 'Naukri', 'LinkedIn Recruiter',
    'Job Portals', 'Background Verification', 'HR Generalist', 'HR Operations', 'Grievance Handling', 'Policy Making', 'Succession Planning',
    'Manpower Planning', 'Contract Staffing', 'Head Hunting', 'Boolean Search', 'Interviewing'],
  sales: ['Sales', 'B2B Sales', 'B2C Sales', 'Direct Sales', 'Field Sales', 'Inside Sales', 'Channel Sales', 'Retail Sales', 'Corporate Sales',
    'Business Development', 'Lead Generation', 'Cold Calling', 'Key Account Management', 'Client Relationship', 'Relationship Management',
    'Negotiation', 'Target Achievement', 'Distribution', 'Dealer Management', 'Distributor Management', 'Market Research', 'CRM',
    'Telesales', 'Telecalling', 'Pre-Sales', 'Customer Acquisition', 'Cross Selling', 'Upselling', 'Territory Management', 'Export',
    'Import', 'EXIM', 'Merchandising', 'Visual Merchandising', 'Real Estate Sales', 'Insurance Sales', 'Banking Sales'],
  marketing: ['Digital Marketing', 'SEO', 'SEM', 'SMM', 'Social Media Marketing', 'Google Ads', 'Meta Ads', 'Facebook Ads', 'Google Analytics',
    'Content Writing', 'Copywriting', 'Email Marketing', 'Brand Management', 'Branding', 'Marketing Strategy', 'Event Management',
    'Public Relations', 'Influencer Marketing', 'Performance Marketing', 'Affiliate Marketing', 'Market Analysis', 'Trade Marketing',
    'Product Marketing', 'Canva', 'WordPress'],
  customer: ['Customer Service', 'Customer Support', 'Customer Relationship Management', 'Client Servicing', 'Front Office', 'Reception',
    'Call Center', 'BPO', 'KPO', 'Voice Process', 'Non-Voice Process', 'Chat Support', 'Email Support', 'Technical Support', 'Help Desk',
    'Complaint Handling', 'Escalation Management', 'Back Office'],
  ops: ['Operations Management', 'Supply Chain', 'Supply Chain Management', 'Logistics', 'Procurement', 'Purchase', 'Vendor Management',
    'Vendor Development', 'Warehouse Management', 'Inventory Control', 'Dispatch', 'Store Management', 'Fleet Management', 'Shipping',
    'Freight Forwarding', 'Customs Clearance', 'Demand Planning', 'Production Planning', 'PPC', 'Quality Control', 'Quality Assurance',
    'QA', 'QC', 'ISO 9001', 'Six Sigma', 'Lean Manufacturing', '5S', 'Kaizen', 'TPM', 'Root Cause Analysis', 'SOP', 'Facility Management',
    'Admin', 'Administration', 'Office Administration', 'Travel Management', 'Housekeeping', 'Security Management', 'EHS', 'HSE', 'Safety',
    'Project Management', 'Program Management', 'Agile', 'Scrum', 'PMP', 'Stakeholder Management', 'Team Management', 'Team Leadership'],
  engineering: ['AutoCAD', 'SolidWorks', 'CATIA', 'Creo', 'ANSYS', 'Revit', 'STAAD Pro', 'ETABS', 'Primavera', 'MS Project', 'PLC', 'SCADA',
    'HVAC', 'MEP', 'Electrical Maintenance', 'Mechanical Maintenance', 'Preventive Maintenance', 'Breakdown Maintenance', 'CNC', 'VMC',
    'Welding', 'Fabrication', 'Machining', 'Tool Room', 'Injection Moulding', 'Sheet Metal', 'Assembly', 'GD&T', 'APQP', 'PPAP', 'FMEA',
    'MSA', 'SPC', 'IATF 16949', 'Instrumentation', 'Civil Engineering', 'Site Execution', 'Quantity Surveying', 'Billing', 'BOQ',
    'Estimation', 'Surveying', 'Interior Design', 'Structural Design', 'Piping', 'Boiler', 'Utility', 'Commissioning', 'Erection',
    'Automobile', 'Production', 'Manufacturing'],
  it: ['Python', 'Java', 'JavaScript', 'TypeScript', 'C', 'C++', 'C#', '.NET', 'ASP.NET', 'PHP', 'Laravel', 'Ruby', 'Go', 'Golang', 'Rust',
    'Kotlin', 'Swift', 'Dart', 'Flutter', 'React', 'React Native', 'Angular', 'Vue', 'Next.js', 'Node.js', 'Express', 'Django', 'Flask',
    'FastAPI', 'Spring', 'Spring Boot', 'Hibernate', 'HTML', 'CSS', 'Bootstrap', 'Tailwind', 'jQuery', 'SQL', 'MySQL', 'PostgreSQL',
    'Oracle', 'SQL Server', 'MongoDB', 'Redis', 'Elasticsearch', 'Firebase', 'AWS', 'Azure', 'GCP', 'Google Cloud', 'Docker', 'Kubernetes',
    'Jenkins', 'CI/CD', 'DevOps', 'Terraform', 'Ansible', 'Linux', 'Unix', 'Shell Scripting', 'Git', 'GitHub', 'Jira', 'REST API',
    'GraphQL', 'Microservices', 'Android', 'iOS', 'Selenium', 'Manual Testing', 'Automation Testing', 'Software Testing', 'API Testing',
    'Postman', 'JMeter', 'Cypress', 'Data Analysis', 'Data Analytics', 'Data Science', 'Machine Learning', 'Deep Learning', 'AI',
    'Generative AI', 'NLP', 'Computer Vision', 'TensorFlow', 'PyTorch', 'Pandas', 'NumPy', 'Power BI', 'Tableau', 'Looker', 'Qlik',
    'Statistics', 'R', 'SAS', 'SPSS', 'Big Data', 'Hadoop', 'Spark', 'Kafka', 'Snowflake', 'Databricks', 'ETL', 'Data Warehousing',
    'Networking', 'CCNA', 'CCNP', 'Hardware', 'System Administration', 'Active Directory', 'Windows Server', 'VMware', 'Cyber Security',
    'Information Security', 'Ethical Hacking', 'Firewall', 'SOC', 'ITIL', 'ServiceNow', 'Salesforce Development', 'UI/UX', 'Figma',
    'Adobe XD', 'Photoshop', 'Illustrator', 'CorelDRAW', 'InDesign', 'Premiere Pro', 'After Effects', 'Video Editing', 'Graphic Design',
    '3D Modeling', 'Blender', 'Web Development', 'Full Stack', 'Frontend', 'Backend', 'Mobile Development'],
  banking: ['Banking', 'Retail Banking', 'Corporate Banking', 'Loans', 'Home Loans', 'Personal Loans', 'Credit Analysis', 'Credit Appraisal',
    'Underwriting', 'KYC', 'AML', 'NBFC', 'Mutual Funds', 'Wealth Management', 'Equity Research', 'Investment Banking', 'Financial Modelling',
    'Valuation', 'Risk Management', 'Insurance', 'Claims Processing', 'NISM', 'Microfinance', 'Branch Management', 'Cash Handling'],
  healthcare: ['Nursing', 'Patient Care', 'Pharmacovigilance', 'Clinical Research', 'Medical Coding', 'Medical Billing', 'Medical Transcription',
    'Lab Technician', 'Pharmacy', 'Hospital Administration', 'Regulatory Affairs', 'GMP', 'Validation', 'Phlebotomy'],
  legal: ['Legal Drafting', 'Contract Management', 'Litigation', 'Corporate Law', 'Legal Research', 'Due Diligence', 'Secretarial Compliance',
    'Company Law', 'Intellectual Property'],
  soft: ['Communication', 'Leadership', 'Problem Solving', 'Time Management', 'Teamwork', 'Presentation Skills', 'Analytical Skills',
    'Decision Making', 'Multitasking', 'Interpersonal Skills', 'Critical Thinking', 'Coordination', 'Training', 'Mentoring'],
  other: ['Driving', 'Two Wheeler License', 'Four Wheeler License', 'Teaching', 'Counselling', 'Hospitality', 'Food and Beverage', 'Culinary',
    'Retail', 'Store Operations', 'Fashion Design', 'Textile', 'Garment', 'Pharma Sales', 'Medical Representative', 'Real Estate',
    'Construction', 'Event Planning', 'Translation', 'Content Moderation', 'Stenography']
};

const SKILLS = [...new Set(Object.values(SKILL_GROUPS).flat())];

// Words that make a document look like a CV (used to skip invoices and other attachments).
const CV_WORDS = ['resume', 'curriculum vitae', 'cv', 'bio data', 'biodata', 'objective', 'career objective', 'professional summary',
  'work experience', 'experience', 'employment history', 'education', 'educational qualification', 'academic', 'qualification',
  'skills', 'key skills', 'technical skills', 'declaration', 'personal details', 'date of birth', 'languages known', 'hobbies',
  'strengths', 'projects', 'responsibilities', 'achievements', 'internship', 'certifications', 'profile summary', 'career summary'];

const LANGUAGES = ['English', 'Hindi', 'Marathi', 'Gujarati', 'Bengali', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Punjabi', 'Urdu',
  'Odia', 'Assamese', 'Konkani', 'Sindhi', 'Sanskrit', 'Nepali', 'Arabic', 'French', 'German', 'Spanish', 'Japanese', 'Mandarin'];

module.exports = { EDUCATION_LEVELS, DEGREES, CITIES, CITY_ALIASES, STATES, SKILLS, SKILL_GROUPS, CV_WORDS, LANGUAGES };
