// Fixed lists used by projects and the NAMA forms (ported from app/models.py).

export const NAMA_DOC_ROWS = {
 "1": "Solar PV Initial Enquiry Acceptance",
 "2": "Operation and Maintenance Plan (Contract)",
 "3": "Building Permit from the Municipality",
 "4": "Civil Defense (if applicable)",
 "5": "Harmonic and Short Circuit Study",
 "6": "Detailed plan of project electricity connection points",
 "7": "Electricity Production Details (PVsyst or other)",
 "8": "Connected load & maximum demand schedules at each connection point",
 "9": "Updated Demand confirmation",
 "10": "Single line diagram, with details of POC, earth pits (AC & DC)",
 "11": "Lightning arrester and protection system",
 "12": "Site layout plan / PV Modules arrangement design",
 "13": "Structural drawings / Civil Layout (with designer's declaration)",
 "14": "Wiring diagram and cable layout and labeling",
 "15": "Plan of substation location (depend on capacity)",
 "16": "Solar PV modules Datasheet, Warranty, and Certificate",
 "17": "Inverters Datasheet, Warranty, and Certificate",
 "18": "Wind load analysis report",
 "19": "Interface Protections compliance (APSR Clause 5.2 MV / 6.2 LV)",
 "20": "Protection single-line diagram and Settings",
 "21": "Other drawings/technical specifications as applicable"
};
export const PREMISES_TYPES = [
 "residential",
 "commercial",
 "governmental",
 "agricultural"
];
export const CONNECTION_TYPES = {
 "self": "Self-investment",
 "lease": "Lease",
 "hybrid": "Hybrid"
};
export const MOUNTING_TYPES = {
 "rooftop": "Rooftop",
 "carpark": "Car park",
 "ground": "Ground mount",
 "other": "Other"
};
export const PROJECT_STATUSES = [
 "draft",
 "initial submitted",
 "initial approved",
 "design submitted",
 "design approved",
 "installed",
 "commissioned",
 "on hold",
 "lost"
];
