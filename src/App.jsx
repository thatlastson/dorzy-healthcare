import { useState, useEffect, useCallback, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════
//  SUPABASE CONFIG
// ═══════════════════════════════════════════════════════════════════
const SUPA_URL = "https://awkavmspstfddkxemdus.supabase.co";
const SUPA_KEY = "sb_publishable_bobwHAeey_0rOvasv46Dbg_q8_CPaF9";

// ═══════════════════════════════════════════════════════════════════
//  AI FEATURES FLAG — set to true when client upgrades to Premium
// ═══════════════════════════════════════════════════════════════════
const AI_ENABLED = false; // Set to true to unlock AI features

const supa = async (path, method="GET", body=null) => {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPA_KEY,
      "Authorization": `Bearer ${SUPA_KEY}`,
      "Prefer": method==="POST" ? "return=representation" : "return=minimal",
    },
    body: body ? JSON.stringify(body) : null,
  });
  if(method==="GET"||method==="POST") {
    try { return await res.json(); } catch { return []; }
  }
  return true;
};

// ═══════════════════════════════════════════════════════════════════
//  DATABASE LAYER — Supabase
// ═══════════════════════════════════════════════════════════════════
const DB = {
  async load() {
    try {
      const [users, inventory, sales, customers, auditLog, settingsArr] = await Promise.all([
        supa("users?select=*&order=created_at.asc"),
        supa("inventory?select=*&order=name.asc"),
        supa("sales?select=*&order=timestamp.desc"),
        supa("customers?select=*&order=name.asc"),
        supa("audit_log?select=*&order=timestamp.desc&limit=300"),
        supa("settings?select=*"),
      ]);
      // Map snake_case DB columns back to camelCase for the app
      const mapInv = i => ({...i, costPrice:i.cost_price, sellingPrice:i.selling_price, reorderLevel:i.reorder_level});
      const mapSale = s => ({...s, recordedBy:s.recorded_by, recordedById:s.recorded_by_id, items:s.items||[]});
      const mapUser = u => ({...u, createdAt:u.created_at});
      const mapCust = c => ({...c, createdAt:c.created_at});
      const mapLog  = l => ({...l});
      const rawSettings = settingsArr?.[0];
      const settings = rawSettings ? {
        pharmacyName: rawSettings.pharmacy_name,
        ownerName:    rawSettings.owner_name,
        phone:        rawSettings.phone||"",
        address:      rawSettings.address||"",
        email:        rawSettings.email||"",
      } : SEED.settings;
      return {
        users:     Array.isArray(users)     ? users.map(mapUser)  : SEED.users,
        inventory: Array.isArray(inventory) ? inventory.map(mapInv) : SEED.inventory,
        sales:     Array.isArray(sales)     ? sales.map(mapSale)  : [],
        customers: Array.isArray(customers) ? customers.map(mapCust) : [],
        auditLog:  Array.isArray(auditLog)  ? auditLog.map(mapLog) : [],
        settings,
      };
    } catch(e) {
      console.error("DB load error:", e);
      return null;
    }
  },

  async saveInventory(items) {
    // Upsert all inventory items
    const rows = items.map(i => ({
      id: i.id, name: i.name, category: i.category, qty: i.qty,
      unit: i.unit, cost_price: i.costPrice||0, selling_price: i.sellingPrice||0,
      reorder_level: i.reorderLevel||0, expiry: i.expiry||"", supplier: i.supplier||"",
    }));
    await supa("inventory?on_conflict=id", "POST", rows);
  },

  async deleteInventoryItem(id) {
    await supa(`inventory?id=eq.${id}`, "DELETE");
  },

  async saveSale(sale) {
    const row = {
      id: sale.id, type: sale.type, customer: sale.customer||"",
      date: sale.date, notes: sale.notes||"", total: sale.total,
      recorded_by: sale.recordedBy||"", recorded_by_id: sale.recordedById||"",
      items: sale.items, timestamp: sale.timestamp||Date.now(),
    };
    await supa("sales?on_conflict=id", "POST", [row]);
  },

  async saveCustomers(customers) {
    const rows = customers.map(c => ({
      id: c.id, name: c.name, phone: c.phone||"", address: c.address||"",
      dob: c.dob||"", allergies: c.allergies||"", notes: c.notes||"",
      created_at: c.createdAt||"",
    }));
    if(rows.length>0) await supa("customers?on_conflict=id", "POST", rows);
  },

  async saveUsers(users) {
    const rows = users.map(u => ({
      id: u.id, name: u.name, email: u.email, password: u.password,
      role: u.role, avatar: u.avatar||"🧑‍💼", active: u.active,
      created_at: u.createdAt||"",
    }));
    await supa("users?on_conflict=id", "POST", rows);
  },

  async saveSettings(s) {
    const row = {
      id: 1,
      pharmacy_name: s.pharmacyName, owner_name: s.ownerName,
      phone: s.phone||"", address: s.address||"", email: s.email||"",
    };
    await supa("settings?on_conflict=id", "POST", [row]);
  },

  async saveAuditLog(entry) {
    const row = {
      id: entry.id, action: entry.action, detail: entry.detail,
      user: entry.user, role: entry.role, timestamp: entry.timestamp,
    };
    await supa("audit_log?on_conflict=id", "POST", [row]);
  },

  async initSeedData(seed) {
    // Only seed if users table is empty
    try {
      const existing = await supa("users?select=id&limit=1");
      if(Array.isArray(existing) && existing.length === 0) {
        await DB.saveUsers(seed.users);
        await DB.saveInventory(seed.inventory);
        await DB.saveSettings(seed.settings);
      }
    } catch(e) { console.error("Seed error:", e); }
  },
};

// ═══════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════
const uid  = () => Date.now().toString(36) + Math.random().toString(36).slice(2);
const fmt  = n  => new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",minimumFractionDigits:0}).format(n||0);
const now  = () => new Date().toISOString().split("T")[0];
const ts   = () => new Date().toLocaleString("en-NG");
const days = d  => Math.ceil((new Date(d) - new Date()) / 86400000);

// ═══════════════════════════════════════════════════════════════════
//  SEED DATA
// ═══════════════════════════════════════════════════════════════════
const SEED = {
  users: [
    { id:"u1", name:"Dora Asuquo", email:"admin@dorzyhealthcare.com", password:"dora123", role:"owner", active:true, createdAt:now(), avatar:"👩‍⚕️" },
    { id:"u2", name:"Sample Staff", email:"staff@pharmacy.com", password:"staff123", role:"staff", active:true, createdAt:now(), avatar:"🧑‍💼" },
  ],
  inventory: [
    { id:"i1", name:"Paracetamol 500mg",  category:"OTC",          qty:200, unit:"Tabs",    costPrice:50,  sellingPrice:80,  reorderLevel:50, expiry:"2026-08-01", supplier:"PharmaCo" },
    { id:"i2", name:"Amoxicillin 250mg",  category:"Prescription", qty:80,  unit:"Caps",    costPrice:120, sellingPrice:200, reorderLevel:30, expiry:"2025-12-15", supplier:"MedSupply" },
    { id:"i3", name:"Ibuprofen 400mg",    category:"OTC",          qty:15,  unit:"Tabs",    costPrice:60,  sellingPrice:100, reorderLevel:40, expiry:"2026-03-20", supplier:"PharmaCo" },
    { id:"i4", name:"Metformin 500mg",    category:"Prescription", qty:120, unit:"Tabs",    costPrice:90,  sellingPrice:150, reorderLevel:25, expiry:"2026-11-01", supplier:"DiabCare" },
    { id:"i5", name:"Vitamin C 1000mg",   category:"OTC",          qty:300, unit:"Tabs",    costPrice:30,  sellingPrice:60,  reorderLevel:80, expiry:"2027-01-01", supplier:"VitaPlus" },
    { id:"i6", name:"Flagyl 400mg",       category:"Prescription", qty:60,  unit:"Tabs",    costPrice:80,  sellingPrice:140, reorderLevel:20, expiry:"2026-06-30", supplier:"MedSupply" },
    { id:"i7", name:"Lisinopril 10mg",    category:"Prescription", qty:90,  unit:"Tabs",    costPrice:110, sellingPrice:180, reorderLevel:25, expiry:"2026-09-01", supplier:"CardioPlus" },
    { id:"i8", name:"ORS Sachet",         category:"OTC",          qty:150, unit:"Sachets", costPrice:20,  sellingPrice:50,  reorderLevel:40, expiry:"2027-03-01", supplier:"PharmaCo" },
  ],
  sales:     [],
  customers: [],
  auditLog:  [],
  settings:  { pharmacyName:"Dorzy Health Care/Minimart", ownerName:"Dora Asuquo", phone:"", address:"Lagos, Nigeria", email:"admin@dorzyhealthcare.com" },
};

// ═══════════════════════════════════════════════════════════════════
//  GLOBAL STYLES
// ═══════════════════════════════════════════════════════════════════
const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500;600&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#0d1528}::-webkit-scrollbar-thumb{background:#1e3a5f;border-radius:4px}
  input,select,textarea,button{font-family:inherit}
  .ni{display:flex;align-items:center;gap:11px;padding:9px 14px;border-radius:10px;cursor:pointer;transition:all .2s;color:#4b5563;border:none;background:none;width:100%;text-align:left;font-size:13.5px;font-weight:500}
  .ni:hover{background:#0d1f3c;color:#94a3b8}
  .ni.active{background:linear-gradient(135deg,#0d3b6e,#162d52);color:#38bdf8;box-shadow:0 0 18px rgba(56,189,248,.12)}
  .card{background:#0d1528;border:1px solid #1e2d45;border-radius:16px;padding:20px}
  .btn{display:inline-flex;align-items:center;gap:7px;padding:9px 18px;border-radius:10px;border:none;font-size:13px;font-weight:600;transition:all .2s;cursor:pointer;white-space:nowrap}
  .btn:disabled{opacity:.5;cursor:not-allowed;transform:none!important}
  .bp{background:linear-gradient(135deg,#0369a1,#0284c7);color:white}.bp:hover:not(:disabled){background:linear-gradient(135deg,#0284c7,#38bdf8);transform:translateY(-1px)}
  .bs{background:linear-gradient(135deg,#065f46,#059669);color:white}.bs:hover:not(:disabled){transform:translateY(-1px)}
  .bd{background:linear-gradient(135deg,#7f1d1d,#dc2626);color:white}.bd:hover:not(:disabled){transform:translateY(-1px)}
  .bg{background:#1e2d45;color:#94a3b8}.bg:hover:not(:disabled){background:#253d5e;color:#e2e8f0}
  .bpurp{background:linear-gradient(135deg,#4c1d95,#7c3aed);color:white}.bpurp:hover:not(:disabled){transform:translateY(-1px)}
  .inp{width:100%;padding:10px 14px;background:#0a1525;border:1.5px solid #1e3a5f;border-radius:10px;color:#e2e8f0;font-size:13px;outline:none;transition:border-color .2s}
  .inp:focus{border-color:#38bdf8;box-shadow:0 0 0 3px rgba(56,189,248,.1)}
  .badge{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700}
  .bo{background:#064e3b;color:#34d399}.brx{background:#1e1b4b;color:#a5b4fc}.bw{background:#451a03;color:#fb923c}.be{background:#450a0a;color:#f87171}.bsuc{background:#052e16;color:#4ade80}
  .tbl{width:100%;border-collapse:collapse;font-size:13px}
  .tbl th{text-align:left;padding:10px 14px;color:#475569;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #1e2d45}
  .tbl td{padding:11px 14px;border-bottom:1px solid #0d1f3c}
  .tbl tr:hover td{background:#0d1f3c40}
  .mo{position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:100;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px)}
  .md{background:#0d1528;border:1px solid #1e3a5f;border-radius:20px;padding:28px;width:520px;max-width:95vw;max-height:90vh;overflow-y:auto}
  .fg{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
  .fg label{font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
  .fr{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}.fi{animation:fadeIn .4s ease}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}.pulse{animation:pulse 1.8s infinite}
  @keyframes scanline{0%{top:0}100%{top:100%}}.scanline{animation:scanline 2s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .role-owner{background:#0c1a3a;color:#60a5fa;border:1px solid #1e3a5f;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700}
  .role-staff{background:#1a0c3a;color:#a78bfa;border:1px solid #3d1e5f;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700}
`;

// ═══════════════════════════════════════════════════════════════════
//  ICONS
// ═══════════════════════════════════════════════════════════════════
const Ic = ({d,size=18,color})=>(
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color||"currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {(Array.isArray(d)?d:[d]).map((p,i)=><path key={i} d={p}/>)}
  </svg>
);
const I = {
  home:   "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  box:    ["M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z","M3.27 6.96L12 12.01l8.73-5.05","M12 22.08V12"],
  cash:   "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  users:  ["M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2","M23 21v-2a4 4 0 0 0-3-3.87","M16 3.13a4 4 0 0 1 0 7.75","M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"],
  file:   ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z","M14 2v6h6","M16 13H8","M16 17H8","M10 9H8"],
  chart:  ["M18 20V10","M12 20V4","M6 20v-6"],
  brain:  ["M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.84A2.5 2.5 0 0 1 9.5 2","M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.84A2.5 2.5 0 0 0 14.5 2"],
  cog:    ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z","M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"],
  log:    ["M9 12h6","M9 16h6","M9 8h6","M5 3h14a2 2 0 0 1 2 2v16l-3-3H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"],
  plus:   ["M12 5v14","M5 12h14"],
  edit:   ["M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7","M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"],
  trash:  ["M3 6h18","M19 6l-1 14H6L5 6","M8 6V4h8v2"],
  x:      ["M18 6L6 18","M6 6l12 12"],
  check:  "M20 6L9 17l-5-5",
  send:   ["M22 2L11 13","M22 2L15 22 11 13 2 9l20-7z"],
  eye:    ["M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z","M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4","M16 17l5-5-5-5","M21 12H9"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"],
  spark:  ["M12 3l1.09 3.26L16 7l-2.91.74L12 11l-1.09-3.26L8 7l2.91-.74L12 3z","M5 14l.55 1.64L7 16.5l-1.45.36L5 18.5l-.55-1.64L3 16.5l1.45-.36L5 14z"],
  menu:   ["M3 12h18","M3 6h18","M3 18h18"],
  alert:  ["M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z","M12 9v4","M12 17h.01"],
  camera: ["M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z","M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  print:  ["M6 9V2h12v7","M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2","M6 14h12v8H6z"],
  scan:   ["M3 7V5a2 2 0 0 1 2-2h2","M17 3h2a2 2 0 0 1 2 2v2","M21 17v2a2 2 0 0 1-2 2h-2","M7 21H5a2 2 0 0 1-2-2v-2","M8 12h8"],
  refresh:["M23 4v6h-6","M1 20v-6h6","M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"],
  key:    ["M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"],
};

// ═══════════════════════════════════════════════════════════════════
//  ROOT APP
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  const [data,    setData]    = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast,   setToast]   = useState(null);

  useEffect(()=>{
    (async()=>{
      // Seed initial data if DB is empty, then load
      await DB.initSeedData(SEED);
      const stored = await DB.load();
      setData(stored || SEED);
      try {
        const s = sessionStorage.getItem("dorzy_session");
        if(s) setSession(JSON.parse(s));
      } catch {}
      setLoading(false);
    })();
  },[]);

  // Smart save — only persists what changed to the right Supabase table
  const save = useCallback(async(d, ops={})=>{
    setData(d);
    try {
      if(ops.inventory)    await DB.saveInventory(d.inventory);
      if(ops.delInvId)     await DB.deleteInventoryItem(ops.delInvId);
      if(ops.sale)         await DB.saveSale(ops.sale);
      if(ops.customers)    await DB.saveCustomers(d.customers);
      if(ops.users)        await DB.saveUsers(d.users);
      if(ops.settings)     await DB.saveSettings(d.settings);
      if(ops.auditEntry)   await DB.saveAuditLog(ops.auditEntry);
    } catch(e) { console.error("Save error:", e); }
  },[]);

  const addLog = useCallback((d, action, detail, user)=>{
    const entry = {id:uid(), action, detail, user:user?.name||"System", role:user?.role||"system", timestamp:ts()};
    return [{...d, auditLog:[entry,...(d.auditLog||[])].slice(0,300)}, entry];
  },[]);

  const showToast = (msg, type="success") => {
    setToast({msg,type});
    setTimeout(()=>setToast(null), 3200);
  };

  const login = async(email, password) => {
    const user = data.users.find(u => u.email===email && u.password===password && u.active);
    if(!user) return false;
    const sd = {id:user.id, name:user.name, email:user.email, role:user.role, avatar:user.avatar};
    setSession(sd);
    try { sessionStorage.setItem("dorzy_session", JSON.stringify(sd)); } catch {}
    const [d2, entry] = addLog(data, "LOGIN", `${user.name} signed in`, user);
    await save(d2, {auditEntry:entry});
    return true;
  };

  const logout = async() => {
    const [d2, entry] = addLog(data, "LOGOUT", `${session.name} signed out`, session);
    await save(d2, {auditEntry:entry});
    try { sessionStorage.removeItem("dorzy_session"); } catch {}
    setSession(null);
  };

  const updateSession = (updates) => {
    const updated = {...session, ...updates};
    setSession(updated);
    try { sessionStorage.setItem("dorzy_session", JSON.stringify(updated)); } catch {}
  };

  if(loading) return <Splash/>;
  if(!session) return <LoginScreen onLogin={login} pharmacyName={data?.settings?.pharmacyName}/>;

  return (
    <MainApp
      data={data}
      session={session}
      save={save}
      addLog={addLog}
      showToast={showToast}
      onLogout={logout}
      updateSession={updateSession}
      toast={toast}
    />
  );
}

// ─── Splash ───────────────────────────────────────────────────────
function Splash(){
  return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#050c1a",flexDirection:"column",gap:16}}>
      <style>{STYLES}</style>
      <div style={{width:64,height:64,borderRadius:16,background:"linear-gradient(135deg,#0369a1,#7c3aed)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:32}}>💊</div>
      <div style={{fontFamily:"Syne,sans-serif",fontSize:20,color:"#38bdf8",fontWeight:800,letterSpacing:"-.01em"}}>DORZY HEALTH CARE</div>
      <div style={{width:24,height:24,border:"2px solid #1e3a5f",borderTopColor:"#38bdf8",borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────
function LoginScreen({onLogin, pharmacyName}){
  const [email,setEmail]     = useState("");
  const [password,setPassword] = useState("");
  const [error,setError]     = useState("");
  const [busy,setBusy]       = useState(false);
  const [showPw,setShowPw]   = useState(false);

  const go = async() => {
    if(!email||!password){ setError("Please fill in all fields"); return; }
    setBusy(true); setError("");
    const ok = await onLogin(email.trim().toLowerCase(), password);
    if(!ok) setError("Invalid email or password. Please try again.");
    setBusy(false);
  };

  return(
    <div style={{display:"flex",height:"100vh",background:"#050c1a",fontFamily:"'DM Sans','Segoe UI',sans-serif"}}>
      <style>{STYLES}{`
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
        .fade-up{animation:fadeUp .6s ease forwards}
        .inp-login{width:100%;padding:12px 16px;background:#0a1525;border:1.5px solid #1e3a5f;border-radius:12px;color:#e2e8f0;font-size:14px;outline:none;font-family:inherit;transition:border-color .2s}
        .inp-login:focus{border-color:#38bdf8;box-shadow:0 0 0 3px rgba(56,189,248,.12)}
      `}</style>

      {/* Left Panel */}
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:40,background:"radial-gradient(ellipse at 30% 50%,#0d2d5e 0%,#050c1a 65%)",overflow:"hidden"}}>
        <div className="fade-up" style={{maxWidth:400,textAlign:"center"}}>
          <div style={{animation:"float 4s ease-in-out infinite",display:"inline-block",marginBottom:24}}>
            <div style={{width:96,height:96,borderRadius:24,background:"linear-gradient(135deg,#0369a1,#7c3aed)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:48,margin:"0 auto",boxShadow:"0 0 60px rgba(56,189,248,.2)"}}>💊</div>
          </div>
          <div style={{fontFamily:"Syne,sans-serif",fontSize:34,fontWeight:800,color:"#f1f5f9",letterSpacing:"-.02em",marginBottom:8}}>{pharmacyName||"Dorzy Health Care/Minimart"}</div>
          <div style={{fontSize:14,color:"#475569",marginBottom:36}}>Intelligent Pharmacy Management — v4.0</div>
          {[
            {i:"📷", t:"Scan drug labels — AI fills in all details automatically"},
            {i:"🧾", t:"Print receipts instantly after every sale"},
            {i:"🔐", t:"Role-based access control with full audit trail"},
            {i:"🤖", t:"AI business intelligence powered by live data"},
          ].map((f,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:12,textAlign:"left",background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.06)",borderRadius:10,padding:"10px 16px",marginBottom:8}}>
              <span style={{fontSize:18}}>{f.i}</span>
              <span style={{fontSize:13,color:"#64748b"}}>{f.t}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right Panel */}
      <div style={{width:460,display:"flex",alignItems:"center",justifyContent:"center",padding:40,background:"#07101f",borderLeft:"1px solid #0d1f3c"}}>
        <div className="fade-up" style={{width:"100%",maxWidth:380}}>
          <div style={{marginBottom:28}}>
            <div style={{fontFamily:"Syne,sans-serif",fontSize:26,fontWeight:800,color:"#f1f5f9",marginBottom:6}}>Welcome back</div>
            <div style={{fontSize:14,color:"#475569"}}>Sign in to your pharmacy dashboard</div>
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div className="fg">
              <label>Email Address</label>
              <input className="inp-login" type="email" placeholder="your@email.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()}/>
            </div>
            <div className="fg">
              <label>Password</label>
              <div style={{position:"relative"}}>
                <input className="inp-login" type={showPw?"text":"password"} placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()} style={{paddingRight:44}}/>
                <button onClick={()=>setShowPw(!showPw)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#475569",cursor:"pointer",padding:4}}>
                  <Ic d={I.eye} size={16}/>
                </button>
              </div>
            </div>

            {error && <div style={{background:"#450a0a",border:"1px solid #7f1d1d",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#fca5a5"}}>{error}</div>}

            <button className="btn bp" style={{width:"100%",justifyContent:"center",padding:13,fontSize:14,borderRadius:12}} onClick={go} disabled={busy}>
              {busy ? "Signing in..." : "Sign In"}
            </button>
          </div>

          <div style={{marginTop:24,padding:14,background:"#0a1525",border:"1px solid #1e3a5f",borderRadius:12}}>
            <div style={{fontSize:11,color:"#475569",fontWeight:700,textTransform:"uppercase",letterSpacing:".05em",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
              <Ic d={I.key} size={12}/> Test Accounts
            </div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn bg" style={{fontSize:12,padding:"6px 12px"}} onClick={()=>{setEmail("admin@dorzyhealthcare.com");setPassword("dora123")}}>👩‍⚕️ Owner Login</button>
              <button className="btn bg" style={{fontSize:12,padding:"6px 12px"}} onClick={()=>{setEmail("staff@pharmacy.com");setPassword("staff123")}}>🧑‍💼 Staff Login</button>
            </div>
            <div style={{fontSize:11,color:"#334155",marginTop:8}}>Click a button above then press Sign In</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN APP SHELL
// ═══════════════════════════════════════════════════════════════════
function MainApp({data, session, save, addLog, showToast, onLogout, updateSession, toast}){
  const [page,setPage]     = useState("dashboard");
  const [sidebar,setSidebar] = useState(true);
  const role = session.role;

  const allNav = [
    {id:"dashboard", label:"Dashboard",    icon:I.home,   roles:["owner","staff"]},
    {id:"inventory", label:"Inventory",    icon:I.box,    roles:["owner","staff"]},
    {id:"sales",     label:"Sales",        icon:I.cash,   roles:["owner","staff"]},
    {id:"records",   label:"Records",      icon:I.file,   roles:["owner","staff"]},
    {id:"reports",   label:"Reports",      icon:I.chart,  roles:["owner"]},
    {id:"ai",        label:"AI Assistant", icon:I.brain,  roles:["owner"], badge:"AI"},
    {id:"users",     label:"User Mgmt",    icon:I.users,  roles:["owner"]},
    {id:"audit",     label:"Audit Log",    icon:I.log,    roles:["owner"]},
    {id:"settings",  label:"Settings",     icon:I.cog,    roles:["owner"]},
  ];
  const nav = allNav.filter(n=>n.roles.includes(role));

  const lowStock  = data.inventory.filter(d=>d.qty<=d.reorderLevel);
  const expiring  = data.inventory.filter(d=>days(d.expiry)<=60&&days(d.expiry)>0);
  const expired   = data.inventory.filter(d=>days(d.expiry)<=0);
  const todaySales= data.sales.filter(s=>s.date===now());
  const todayRev  = todaySales.reduce((a,s)=>a+s.total,0);

  const ctx = {data, session, save, addLog, showToast, role, lowStock, expiring, expired, todayRev, todaySales, updateSession};

  return(
    <div style={{display:"flex",height:"100vh",fontFamily:"'DM Sans','Segoe UI',sans-serif",background:"#070d1a",color:"#e2e8f0",overflow:"hidden"}}>
      <style>{STYLES}</style>

      {/* ── Sidebar ── */}
      <div style={{width:sidebar?224:60,background:"#07101f",borderRight:"1px solid #0d1f3c",display:"flex",flexDirection:"column",transition:"width .3s",overflow:"hidden",flexShrink:0}}>
        {/* Logo */}
        <div style={{padding:"18px 14px",borderBottom:"1px solid #0d1f3c",display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:34,height:34,borderRadius:10,background:"linear-gradient(135deg,#0369a1,#7c3aed)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:17}}>💊</div>
          {sidebar&&<div>
            <div style={{fontFamily:"Syne,sans-serif",fontSize:12,fontWeight:800,color:"#38bdf8",whiteSpace:"nowrap"}}>DORZY HEALTH CARE</div>
            <div style={{fontSize:9,color:"#334155",whiteSpace:"nowrap",letterSpacing:".08em"}}>v4.0 · DORZY SYSTEM</div>
          </div>}
        </div>

        {/* Alerts strip */}
        {sidebar&&(lowStock.length>0||expiring.length>0)&&(
          <div style={{padding:"10px 14px",borderBottom:"1px solid #0d1f3c"}}>
            {lowStock.length>0&&<div style={{fontSize:11,color:"#f87171",marginBottom:3}}>⚠ {lowStock.length} low stock</div>}
            {expiring.length>0&&<div style={{fontSize:11,color:"#fb923c"}}>⏰ {expiring.length} expiring soon</div>}
          </div>
        )}

        {/* Nav */}
        <nav style={{flex:1,padding:"10px 8px",display:"flex",flexDirection:"column",gap:2,overflowY:"auto"}}>
          {nav.map(item=>(
            <button key={item.id} className={`ni${page===item.id?" active":""}`} onClick={()=>setPage(item.id)}>
              <Ic d={item.icon} size={17}/>
              {sidebar&&<>
                <span style={{flex:1}}>{item.label}</span>
                {item.badge&&<span style={{fontSize:9,background:"linear-gradient(135deg,#7c3aed,#0369a1)",color:"white",padding:"2px 6px",borderRadius:8,fontWeight:800}}>{item.badge}</span>}
              </>}
            </button>
          ))}
        </nav>

        {/* Profile + controls */}
        <div style={{padding:10,borderTop:"1px solid #0d1f3c"}}>
          {sidebar&&(
            <div style={{background:"#0a1525",borderRadius:10,padding:"10px 12px",marginBottom:8,display:"flex",alignItems:"center",gap:10}}>
              <div style={{fontSize:22,flexShrink:0}}>{session.avatar}</div>
              <div style={{flex:1,overflow:"hidden"}}>
                {/* ── FIX: displays live session.name, updates instantly on settings change ── */}
                <div style={{fontSize:12,fontWeight:700,color:"#e2e8f0",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{session.name}</div>
                <span className={`role-${session.role}`}>{session.role}</span>
              </div>
            </div>
          )}
          <button className="ni" style={{color:"#ef4444",justifyContent:sidebar?"flex-start":"center"}} onClick={onLogout}>
            <Ic d={I.logout} size={16}/>{sidebar&&"Sign Out"}
          </button>
          <button className="ni" style={{justifyContent:sidebar?"flex-start":"center"}} onClick={()=>setSidebar(!sidebar)}>
            <Ic d={I.menu} size={16}/>{sidebar&&"Collapse"}
          </button>
        </div>
      </div>

      {/* ── Main content ── */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {/* Top bar */}
        <div style={{padding:"14px 24px",borderBottom:"1px solid #0d1f3c",display:"flex",alignItems:"center",justifyContent:"space-between",background:"#07101f"}}>
          <div>
            <h1 style={{fontFamily:"Syne,sans-serif",fontSize:19,fontWeight:800,color:"#f1f5f9"}}>{nav.find(n=>n.id===page)?.label}</h1>
            <div style={{fontSize:11,color:"#334155"}}>{new Date().toLocaleDateString("en-NG",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            {expired.length>0&&<div style={{fontSize:12,background:"#450a0a",color:"#f87171",padding:"5px 12px",borderRadius:8,fontWeight:700}}>⛔ {expired.length} expired</div>}
            <div style={{fontSize:11,background:role==="owner"?"#0c1a3a":"#1a0c3a",color:role==="owner"?"#60a5fa":"#a78bfa",padding:"5px 12px",borderRadius:8,fontWeight:700,border:`1px solid ${role==="owner"?"#1e3a5f":"#3d1e5f"}`}}>
              {role==="owner"?"👑 Owner":"🧑‍💼 Staff"}
            </div>
          </div>
        </div>

        {/* Page content */}
        <div style={{flex:1,overflow:"auto",padding:22}}>
          {page==="dashboard" &&<Dashboard  {...ctx}/>}
          {page==="inventory" &&<Inventory  {...ctx}/>}
          {page==="sales"     &&<Sales      {...ctx}/>}
          {page==="records"   &&<Records    {...ctx}/>}
          {page==="reports"   &&role==="owner"&&<Reports    {...ctx}/>}
          {page==="ai"        &&role==="owner"&&<AIAssistant {...ctx}/>}
          {page==="users"     &&role==="owner"&&<UserMgmt   {...ctx}/>}
          {page==="audit"     &&role==="owner"&&<AuditLog   {...ctx}/>}
          {page==="settings"  &&role==="owner"&&<Settings   {...ctx}/>}
        </div>
      </div>

      {/* Toast */}
      {toast&&(
        <div className="fi" style={{position:"fixed",bottom:22,right:22,background:toast.type==="success"?"#052e16":"#450a0a",border:`1px solid ${toast.type==="success"?"#166534":"#991b1b"}`,color:toast.type==="success"?"#4ade80":"#f87171",padding:"11px 18px",borderRadius:12,fontSize:13,fontWeight:700,zIndex:999}}>
          {toast.type==="success"?"✓":"✗"} {toast.msg}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  SCAN-TO-ADD MODAL
// ═══════════════════════════════════════════════════════════════════
function ScanModal({onClose, onSuggestion}){
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [phase,setPhase]           = useState("camera");
  const [capturedImg,setCaptured]  = useState(null);
  const [suggestion,setSuggestion] = useState(null);
  const [errMsg,setErrMsg]         = useState("");
  const [camErr,setCamErr]         = useState("");

  useEffect(()=>{ startCam(); return ()=>stopCam(); },[]);

  const startCam = async() => {
    try{
      const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment",width:{ideal:1280},height:{ideal:720}}});
      streamRef.current = stream;
      if(videoRef.current){ videoRef.current.srcObject=stream; videoRef.current.play(); }
    }catch{
      setCamErr("Camera access denied or unavailable. Use manual entry instead.");
    }
  };

  const stopCam = () => { if(streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop()); };

  const capture = () => {
    const v=videoRef.current, c=canvasRef.current;
    if(!v||!c) return;
    c.width=v.videoWidth||640; c.height=v.videoHeight||480;
    c.getContext("2d").drawImage(v,0,0);
    setCaptured(c.toDataURL("image/jpeg",0.85));
    setPhase("captured"); stopCam();
  };

  const analyse = async() => {
    setPhase("analysing");
    const base64 = capturedImg.split(",")[1];
    try{
      const res = await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json","anthropic-dangerous-direct-browser-access":"true"},
        body:JSON.stringify({
          model:"claude-sonnet-4-20250514",
          max_tokens:800,
          messages:[{role:"user",content:[
            {type:"image",source:{type:"base64",media_type:"image/jpeg",data:base64}},
            {type:"text",text:`You are a pharmacy assistant for a Nigerian pharmacy. Analyse this drug/medicine image and extract:
- name: full drug name with dosage e.g. "Paracetamol 500mg"
- category: "OTC" or "Prescription"
- unit: one of Tabs, Caps, Bottles, Vials, Sachets, Pieces
- suggestedSellingPrice: Nigerian Naira number only
- suggestedCostPrice: Nigerian Naira number only
- supplier: manufacturer name or "Unknown"
- notes: storage or handling notes
- confidence: "high", "medium", "low", or "none" if not a drug

Respond ONLY with valid JSON, no markdown:
{"name":"","category":"OTC","unit":"Tabs","suggestedSellingPrice":0,"suggestedCostPrice":0,"supplier":"","notes":"","confidence":""}`}
          ]}]
        })
      });
      const d = await res.json();
      const parsed = JSON.parse(d.content[0].text.replace(/```json|```/g,"").trim());
      if(parsed.confidence==="none"){ setErrMsg("No drug detected. Try a clearer image of the label."); setPhase("error"); }
      else { setSuggestion(parsed); setPhase("result"); }
    }catch{
      setErrMsg("Could not analyse. Check connection or use manual entry.");
      setPhase("error");
    }
  };

  const retry = () => { setCaptured(null); setSuggestion(null); setErrMsg(""); setPhase("camera"); setTimeout(startCam,100); };

  return(
    <div className="mo">
      <div style={{background:"#0d1528",border:"1px solid #1e3a5f",borderRadius:20,width:560,maxWidth:"95vw",overflow:"hidden"}}>
        {/* Header */}
        <div style={{padding:"18px 22px",borderBottom:"1px solid #1e2d45",display:"flex",justifyContent:"space-between",alignItems:"center",background:"linear-gradient(135deg,#0d1b3e,#0d1528)"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:36,height:36,borderRadius:10,background:"linear-gradient(135deg,#7c3aed,#0369a1)",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.camera} size={18} color="white"/></div>
            <div>
              <div style={{fontFamily:"Syne,sans-serif",fontSize:15,fontWeight:800,color:"#f1f5f9"}}>AI Scan-to-Add</div>
              <div style={{fontSize:11,color:"#475569"}}>Point camera at drug label — AI identifies it</div>
            </div>
          </div>
          <button className="btn bg" style={{padding:"5px 8px"}} onClick={onClose}><Ic d={I.x} size={14}/></button>
        </div>

        {/* Camera / Captured */}
        {(phase==="camera"||phase==="captured")&&(
          <div>
            {camErr ? (
              <div style={{padding:28,textAlign:"center"}}>
                <div style={{fontSize:32,marginBottom:12}}>📷</div>
                <div style={{color:"#f87171",fontSize:13,marginBottom:16,lineHeight:1.6}}>{camErr}</div>
                <button className="btn bg" onClick={onClose}>Use Manual Entry</button>
              </div>
            ):(
              <div style={{position:"relative",background:"#000"}}>
                {phase==="camera"&&(
                  <>
                    <video ref={videoRef} style={{width:"100%",maxHeight:300,display:"block",objectFit:"cover"}} autoPlay playsInline muted/>
                    <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
                      <div style={{width:200,height:140,border:"2px solid #38bdf8",borderRadius:12,boxShadow:"0 0 0 2000px rgba(0,0,0,.4)",position:"relative",overflow:"hidden"}}>
                        <div className="scanline" style={{position:"absolute",left:0,right:0,height:2,background:"linear-gradient(90deg,transparent,#38bdf8,transparent)",opacity:.8}}/>
                        <div style={{position:"absolute",top:-1,left:-1,width:20,height:20,borderTop:"3px solid #38bdf8",borderLeft:"3px solid #38bdf8",borderRadius:"4px 0 0 0"}}/>
                        <div style={{position:"absolute",top:-1,right:-1,width:20,height:20,borderTop:"3px solid #38bdf8",borderRight:"3px solid #38bdf8",borderRadius:"0 4px 0 0"}}/>
                        <div style={{position:"absolute",bottom:-1,left:-1,width:20,height:20,borderBottom:"3px solid #38bdf8",borderLeft:"3px solid #38bdf8",borderRadius:"0 0 0 4px"}}/>
                        <div style={{position:"absolute",bottom:-1,right:-1,width:20,height:20,borderBottom:"3px solid #38bdf8",borderRight:"3px solid #38bdf8",borderRadius:"0 0 4px 0"}}/>
                      </div>
                    </div>
                    <div style={{position:"absolute",bottom:12,left:0,right:0,textAlign:"center",fontSize:12,color:"rgba(255,255,255,.7)"}}>Position drug label within the frame</div>
                  </>
                )}
                {phase==="captured"&&<img src={capturedImg} style={{width:"100%",maxHeight:300,display:"block",objectFit:"cover"}} alt="Captured"/>}
              </div>
            )}
            <canvas ref={canvasRef} style={{display:"none"}}/>
            {!camErr&&(
              <div style={{padding:16,display:"flex",gap:10,justifyContent:"center"}}>
                {phase==="camera"&&<button className="btn bpurp" style={{padding:"10px 28px"}} onClick={capture}><Ic d={I.camera} size={15}/> Capture</button>}
                {phase==="captured"&&<>
                  <button className="btn bg" onClick={retry}><Ic d={I.refresh} size={14}/> Retake</button>
                  <button className="btn bpurp" onClick={analyse}><Ic d={I.brain} size={14}/> Analyse with AI</button>
                </>}
              </div>
            )}
          </div>
        )}

        {/* Analysing */}
        {phase==="analysing"&&(
          <div style={{padding:48,textAlign:"center"}}>
            <div style={{fontSize:48,marginBottom:16}} className="pulse">🤖</div>
            <div style={{fontFamily:"Syne,sans-serif",fontSize:16,fontWeight:800,color:"#a78bfa",marginBottom:8}}>Reading the label...</div>
            <div style={{fontSize:13,color:"#475569"}}>Identifying drug, dosage, category & pricing</div>
          </div>
        )}

        {/* Error */}
        {phase==="error"&&(
          <div style={{padding:32,textAlign:"center"}}>
            <div style={{fontSize:40,marginBottom:12}}>⚠️</div>
            <div style={{color:"#f87171",fontSize:13,marginBottom:20,lineHeight:1.6}}>{errMsg}</div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <button className="btn bg" onClick={retry}><Ic d={I.refresh} size={14}/> Try Again</button>
              <button className="btn bg" onClick={onClose}>Manual Entry</button>
            </div>
          </div>
        )}

        {/* Result */}
        {phase==="result"&&suggestion&&(
          <div style={{padding:22}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
              <div style={{width:28,height:28,background:"#052e16",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>✓</div>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:"#4ade80"}}>Drug Identified!</div>
                <div style={{fontSize:11,color:"#475569"}}>Confidence: <span style={{color:suggestion.confidence==="high"?"#4ade80":suggestion.confidence==="medium"?"#fb923c":"#f87171",fontWeight:700}}>{suggestion.confidence}</span> — review before saving</div>
              </div>
            </div>
            <div style={{background:"#0a1525",border:"1px solid #1e3a5f",borderRadius:12,padding:16,marginBottom:14}}>
              {[["Drug Name",suggestion.name,"#f1f5f9"],["Category",suggestion.category,"#a78bfa"],["Unit",suggestion.unit,"#94a3b8"],["Suggested Sell Price",fmt(suggestion.suggestedSellingPrice),"#4ade80"],["Suggested Cost Price",fmt(suggestion.suggestedCostPrice),"#38bdf8"],["Supplier",suggestion.supplier,"#64748b"],["Notes",suggestion.notes||"None","#475569"]].map(([l,v,c])=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #0d1f3c",gap:12}}>
                  <span style={{fontSize:11,color:"#475569",flexShrink:0}}>{l}</span>
                  <span style={{fontSize:13,fontWeight:600,color:c,textAlign:"right"}}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{background:"#1a0533",border:"1px solid #3d1e5f",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#a78bfa"}}>
              💡 AI suggestions — please verify pricing and category before saving.
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button className="btn bg" onClick={retry}><Ic d={I.refresh} size={13}/> Scan Again</button>
              <button className="btn bg" onClick={onClose}>Cancel</button>
              <button className="btn bs" onClick={()=>onSuggestion(suggestion)}><Ic d={I.check} size={13}/> Use This Data</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  RECEIPT MODAL
// ═══════════════════════════════════════════════════════════════════
function ReceiptModal({sale, settings, onClose}){
  const receiptRef = useRef(null);
  const receiptNo  = sale.id.slice(-6).toUpperCase();

  const print = () => {
    const win = window.open("","_blank","width=420,height=650");
    win.document.write(`<html><head><title>Receipt #${receiptNo}</title>
    <style>
      *{box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:12px;max-width:320px;margin:20px auto;color:#000}
      h2{text-align:center;font-size:15px;margin-bottom:3px;font-family:sans-serif}
      .center{text-align:center}.dashed{border-top:1px dashed #000;margin:8px 0}
      .row{display:flex;justify-content:space-between;margin:3px 0}
      .bold{font-weight:bold}.total{font-size:14px}.small{font-size:10px;color:#555}
    </style></head><body>
    <h2>${settings?.pharmacyName||"Dorzy Health Care/Minimart"}</h2>
    ${settings?.address?`<div class="center small">${settings.address}</div>`:""}
    ${settings?.phone?`<div class="center small">Tel: ${settings.phone}</div>`:""}
    <div class="dashed"></div>
    <div class="row"><span>Receipt:</span><span>#${receiptNo}</span></div>
    <div class="row"><span>Date:</span><span>${sale.date}</span></div>
    <div class="row"><span>Type:</span><span>${sale.type}</span></div>
    ${sale.customer?`<div class="row"><span>Customer:</span><span>${sale.customer}</span></div>`:""}
    <div class="row"><span>Served by:</span><span>${sale.recordedBy||"—"}</span></div>
    <div class="dashed"></div>
    <div class="bold" style="margin-bottom:6px">ITEMS PURCHASED</div>
    ${sale.items.map(i=>`
      <div class="bold">${i.name}</div>
      <div class="row small"><span>${i.qty} unit(s) × ₦${i.price.toLocaleString()}</span><span>₦${i.subtotal.toLocaleString()}</span></div>
    `).join("")}
    <div class="dashed"></div>
    <div class="row bold total"><span>TOTAL</span><span>₦${sale.total.toLocaleString()}</span></div>
    ${sale.notes?`<div class="dashed"></div><div class="small">Note: ${sale.notes}</div>`:""}
    <div class="dashed"></div>
    <div class="center small">Thank you for your patronage!<br/>Get well soon 💊<br/>${settings?.pharmacyName||"Dorzy Health Care/Minimart"}</div>
    </body></html>`);
    win.document.close();
    win.focus();
    setTimeout(()=>{ win.print(); win.close(); }, 400);
  };

  return(
    <div className="mo">
      <div className="md" style={{width:420}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <div style={{fontFamily:"Syne,sans-serif",fontSize:16,fontWeight:800,color:"#f1f5f9",display:"flex",alignItems:"center",gap:8}}>
            🧾 Sale Receipt
          </div>
          <button className="btn bg" style={{padding:"4px 7px"}} onClick={onClose}><Ic d={I.x} size={13}/></button>
        </div>

        {/* Preview */}
        <div style={{background:"white",borderRadius:12,padding:"20px 18px",marginBottom:16,color:"#111",fontFamily:"'Courier New',monospace",fontSize:12}}>
          <div ref={receiptRef}>
            <div style={{textAlign:"center",fontFamily:"sans-serif",fontWeight:800,fontSize:15,marginBottom:3}}>{settings?.pharmacyName||"Dorzy Health Care/Minimart"}</div>
            {settings?.address&&<div style={{textAlign:"center",fontSize:11,color:"#555",marginBottom:2}}>{settings.address}</div>}
            {settings?.phone&&<div style={{textAlign:"center",fontSize:11,color:"#555",marginBottom:8}}>Tel: {settings.phone}</div>}
            <div style={{borderTop:"1px dashed #999",borderBottom:"1px dashed #999",padding:"6px 0",marginBottom:8}}>
              {[["Receipt No",`#${receiptNo}`],["Date",sale.date],["Type",sale.type],sale.customer&&["Customer",sale.customer],["Served by",sale.recordedBy||"—"]].filter(Boolean).map(([l,v])=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between",margin:"2px 0"}}><span>{l}:</span><span style={{fontWeight:600}}>{v}</span></div>
              ))}
            </div>
            <div style={{fontWeight:"bold",marginBottom:6}}>ITEMS PURCHASED</div>
            {sale.items.map((item,i)=>(
              <div key={i} style={{marginBottom:6}}>
                <div style={{fontWeight:"bold"}}>{item.name}</div>
                <div style={{display:"flex",justifyContent:"space-between",color:"#555",fontSize:11}}>
                  <span>{item.qty} unit(s) × ₦{item.price.toLocaleString()}</span>
                  <span>₦{item.subtotal.toLocaleString()}</span>
                </div>
              </div>
            ))}
            <div style={{borderTop:"1px dashed #999",paddingTop:6,marginTop:4}}>
              <div style={{display:"flex",justifyContent:"space-between",fontWeight:"bold",fontSize:14}}>
                <span>TOTAL</span><span>₦{sale.total.toLocaleString()}</span>
              </div>
            </div>
            {sale.notes&&<div style={{marginTop:6,fontSize:10,color:"#666",borderTop:"1px dashed #eee",paddingTop:6}}>Note: {sale.notes}</div>}
            <div style={{textAlign:"center",marginTop:12,fontSize:10,color:"#888",borderTop:"1px dashed #eee",paddingTop:8}}>
              Thank you for your patronage!<br/>Get well soon 💊
            </div>
          </div>
        </div>

        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button className="btn bg" onClick={onClose}>Close</button>
          <button className="btn bp" onClick={print}><Ic d={I.print} size={13}/> Print Receipt</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════════
function Dashboard({data, role, lowStock, expiring, expired, todayRev, todaySales}){
  const totalVal  = data.inventory.reduce((a,i)=>a+i.qty*i.sellingPrice,0);
  const weekSales = data.sales.filter(s=>{const d=new Date(s.date),w=new Date();w.setDate(w.getDate()-7);return d>=w;});
  const weekRev   = weekSales.reduce((a,s)=>a+s.total,0);
  const drugSales = {};
  data.sales.forEach(s=>s.items.forEach(i=>{drugSales[i.name]=(drugSales[i.name]||0)+i.qty;}));
  const topDrugs  = Object.entries(drugSales).sort((a,b)=>b[1]-a[1]).slice(0,3);

  const stats = [
    {l:"Today's Revenue", v:fmt(todayRev),     s:`${todaySales.length} transactions`, c:"#4ade80", i:"💰"},
    {l:"This Week",       v:fmt(weekRev),       s:`${weekSales.length} sales`,         c:"#38bdf8", i:"📈", owner:true},
    {l:"Stock Value",     v:fmt(totalVal),      s:`${data.inventory.length} drug lines`,c:"#a78bfa",i:"📦", owner:true},
    {l:"Customers",       v:data.customers.length, s:"registered",                    c:"#fb923c", i:"👥"},
  ].filter(s=>!s.owner||role==="owner");

  return(
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:14}}>
        {stats.map((s,i)=>(
          <div key={i} style={{background:"linear-gradient(135deg,#0d1528,#0d1f3c)",border:"1px solid #1e3a5f",borderRadius:16,padding:18}}>
            <div style={{fontSize:26,marginBottom:8}}>{s.i}</div>
            <div style={{fontSize:22,fontWeight:800,color:s.c}}>{s.v}</div>
            <div style={{fontSize:13,color:"#64748b",marginTop:2}}>{s.l}</div>
            <div style={{fontSize:11,color:"#334155",marginTop:3}}>{s.s}</div>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div className="card">
          <div style={{fontSize:14,fontWeight:700,color:"#f1f5f9",marginBottom:14,display:"flex",alignItems:"center",gap:8}}><Ic d={I.alert} size={15} color="#fb923c"/> Alerts</div>
          {expired.length===0&&lowStock.length===0&&expiring.length===0
            ? <div style={{color:"#4ade80",fontSize:13}}>✓ All clear — no urgent alerts</div>
            : <div style={{display:"flex",flexDirection:"column",gap:7}}>
                {expired.map(d=><AR key={d.id} type="e" label={`EXPIRED: ${d.name}`} sub="Remove from shelf immediately"/>)}
                {lowStock.map(d=><AR key={d.id} type="w" label={`Low Stock: ${d.name}`} sub={`Only ${d.qty} ${d.unit} remaining`}/>)}
                {expiring.map(d=><AR key={d.id} type="i" label={`Expiring Soon: ${d.name}`} sub={`${days(d.expiry)} days left`}/>)}
              </div>
          }
        </div>
        <div className="card">
          <div style={{fontSize:14,fontWeight:700,color:"#f1f5f9",marginBottom:14}}>🏆 Top Sellers</div>
          {topDrugs.length===0
            ? <div style={{color:"#475569",fontSize:13}}>No sales recorded yet</div>
            : topDrugs.map(([name,qty],i)=>(
              <div key={name} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                <div style={{width:24,height:24,borderRadius:6,background:["#0369a1","#065f46","#4c1d95"][i],display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"white",flexShrink:0}}>{i+1}</div>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>{name}</div>
                  <div style={{fontSize:11,color:"#475569"}}>{qty} units sold</div>
                </div>
              </div>
            ))
          }
        </div>
      </div>

      <div className="card">
        <div style={{fontSize:14,fontWeight:700,color:"#f1f5f9",marginBottom:14}}>Recent Transactions</div>
        {data.sales.length===0
          ? <div style={{color:"#475569",fontSize:13}}>No sales yet</div>
          : <table className="tbl">
              <thead><tr><th>Date</th><th>Items</th><th>Type</th><th>By</th>{role==="owner"&&<th>Amount</th>}</tr></thead>
              <tbody>{[...data.sales].reverse().slice(0,8).map(s=>(
                <tr key={s.id}>
                  <td style={{color:"#64748b"}}>{s.date}</td>
                  <td style={{color:"#e2e8f0",fontSize:12}}>{s.items.map(i=>i.name).join(", ").slice(0,40)}</td>
                  <td><span className={`badge ${s.type==="OTC"?"bo":"brx"}`}>{s.type}</span></td>
                  <td style={{color:"#64748b",fontSize:12}}>{s.recordedBy||"—"}</td>
                  {role==="owner"&&<td style={{color:"#4ade80",fontWeight:700}}>{fmt(s.total)}</td>}
                </tr>
              ))}</tbody>
            </table>
        }
      </div>
    </div>
  );
}

function AR({type,label,sub}){
  const c = {e:{bg:"#450a0a",t:"#f87171",b:"#7f1d1d"},w:{bg:"#451a03",t:"#fb923c",b:"#92400e"},i:{bg:"#172554",t:"#93c5fd",b:"#1e40af"}}[type];
  return(
    <div style={{background:c.bg,border:`1px solid ${c.b}`,borderRadius:8,padding:"7px 12px"}}>
      <div style={{fontSize:12,fontWeight:700,color:c.t}}>{label}</div>
      <div style={{fontSize:11,color:c.t,opacity:.7}}>{sub}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  INVENTORY — with Scan-to-Add
// ═══════════════════════════════════════════════════════════════════
function Inventory({data, session, save, addLog, showToast, role}){
  const [modal,setModal]       = useState(false);
  const [scanModal,setScan]    = useState(false);
  const [confirmDel,setConfirm]= useState(null); // item to delete
  const [editing,setEditing]   = useState(null);
  const [search,setSearch]     = useState("");
  const [filter,setFilter]     = useState("All");
  const isOwner = role==="owner";
  const E = {name:"",category:"OTC",qty:"",unit:"Tabs",costPrice:"",sellingPrice:"",reorderLevel:"",expiry:"",supplier:""};
  const [form,setForm] = useState(E);

  const filtered = data.inventory.filter(d=>{
    const ms = d.name.toLowerCase().includes(search.toLowerCase());
    const mf = filter==="All" || (
      filter==="Low Stock" ? d.qty<=d.reorderLevel :
      filter==="Expiring"  ? days(d.expiry)<=60&&days(d.expiry)>0 :
      filter==="Expired"   ? days(d.expiry)<=0 :
      d.category===filter
    );
    return ms&&mf;
  });

  const openAdd  = () => { setForm(E); setEditing(null); setModal(true); };
  const openEdit = (item) => { if(!isOwner) return; setForm({...item}); setEditing(item.id); setModal(true); };

  const handleScanSuggestion = (sug) => {
    setScan(false);
    setForm({name:sug.name||"",category:sug.category||"OTC",qty:"",unit:sug.unit||"Tabs",costPrice:sug.suggestedCostPrice||"",sellingPrice:sug.suggestedSellingPrice||"",reorderLevel:"",expiry:"",supplier:sug.supplier||""});
    setEditing(null);
    setModal(true);
    showToast("AI filled drug details — please complete and verify");
  };

  const handleSave = () => {
    if(!form.name||!form.qty||!form.sellingPrice) return showToast("Name, quantity and price are required","error");
    const inv = editing
      ? data.inventory.map(i=>i.id===editing?{...form,id:editing}:i)
      : [...data.inventory,{...form,id:uid()}];
    const [d2,entry] = addLog({...data,inventory:inv}, editing?"INVENTORY_UPDATE":"INVENTORY_ADD", `${editing?"Updated":"Added"}: ${form.name}`, session);
    save(d2,{inventory:true,auditEntry:entry}); showToast(editing?"Drug updated successfully":"Drug added successfully"); setModal(false);
  };

  const handleDel = (item) => { if(!isOwner) return; setConfirm(item); };

  const confirmDelete = () => {
    const item = confirmDel;
    const [d2,entry] = addLog({...data,inventory:data.inventory.filter(i=>i.id!==item.id)}, "INVENTORY_DELETE", `Removed: ${item.name}`, session);
    save(d2,{inventory:true,delInvId:item.id,auditEntry:entry});
    showToast(`${item.name} removed from inventory`);
    setConfirm(null);
  };

  return(
    <div>
      {scanModal&&<ScanModal onClose={()=>setScan(false)} onSuggestion={handleScanSuggestion}/>}

      {confirmDel&&(
        <div className="mo">
          <div style={{background:"#0d1528",border:"1px solid #7f1d1d",borderRadius:20,padding:28,width:420,maxWidth:"95vw",textAlign:"center"}}>
            <div style={{fontSize:40,marginBottom:14}}>🗑️</div>
            <div style={{fontFamily:"Syne,sans-serif",fontSize:16,fontWeight:800,color:"#f1f5f9",marginBottom:8}}>Delete Drug?</div>
            <div style={{fontSize:13,color:"#94a3b8",marginBottom:6}}>You are about to permanently delete:</div>
            <div style={{fontSize:15,fontWeight:700,color:"#f87171",marginBottom:8}}>{confirmDel.name}</div>
            <div style={{fontSize:12,color:"#475569",background:"#0a1525",borderRadius:10,padding:"10px 14px",marginBottom:20}}>
              ⚠️ This action cannot be undone. All stock records for this drug will be removed.
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <button className="btn bg" style={{padding:"10px 24px"}} onClick={()=>setConfirm(null)}>Cancel — Keep It</button>
              <button className="btn bd" style={{padding:"10px 24px"}} onClick={confirmDelete}>Yes, Delete It</button>
            </div>
          </div>
        </div>
      )}

      {false&&<span/>}

      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <input className="inp" style={{maxWidth:220}} placeholder="Search drugs..." value={search} onChange={e=>setSearch(e.target.value)}/>
        {["All","OTC","Prescription","Low Stock","Expiring","Expired"].map(f=>(
          <button key={f} className={`btn ${filter===f?"bp":"bg"}`} style={{padding:"6px 12px",fontSize:12}} onClick={()=>setFilter(f)}>{f}</button>
        ))}
        {isOwner&&<div style={{display:"flex",gap:8,marginLeft:"auto"}}>
          {AI_ENABLED && <button className="btn bpurp" onClick={()=>setScan(true)}><Ic d={I.scan} size={13}/> 📷 Scan to Add</button>}
          <button className="btn bs" onClick={openAdd}><Ic d={I.plus} size={13}/> Manual Add</button>
        </div>}
      </div>

      {isOwner&&AI_ENABLED&&(
        <div style={{background:"linear-gradient(135deg,#1a0533,#0d1b3e)",border:"1px solid #3d1e5f",borderRadius:12,padding:"12px 16px",marginBottom:14,display:"flex",alignItems:"center",gap:12}}>
          <div style={{fontSize:24}}>📷</div>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:700,color:"#a78bfa"}}>AI Scan-to-Add is Active</div>
            <div style={{fontSize:12,color:"#475569"}}>Point your camera at any drug packaging — AI reads the label and pre-fills all details. Reduces data entry errors significantly.</div>
          </div>
          <button className="btn bpurp" style={{flexShrink:0}} onClick={()=>setScan(true)}><Ic d={I.camera} size={14}/> Try It</button>
        </div>
      )}

      <div className="card" style={{padding:0,overflow:"hidden"}}>
        <table className="tbl">
          <thead><tr><th>Drug Name</th><th>Category</th><th>Stock</th><th>Sell Price</th><th>Expiry</th><th>Status</th>{isOwner&&<th>Actions</th>}</tr></thead>
          <tbody>
            {filtered.length===0
              ? <tr><td colSpan={7} style={{textAlign:"center",padding:32,color:"#334155"}}>No drugs found</td></tr>
              : filtered.map(item=>{
                  const d2=days(item.expiry), isLow=item.qty<=item.reorderLevel, isExp=d2<=0, isWarn=d2>0&&d2<=60;
                  return(
                    <tr key={item.id}>
                      <td style={{fontWeight:600,color:"#f1f5f9"}}>{item.name}<div style={{fontSize:11,color:"#334155"}}>{item.supplier}</div></td>
                      <td><span className={`badge ${item.category==="OTC"?"bo":"brx"}`}>{item.category}</span></td>
                      <td style={{color:isLow?"#f87171":"#e2e8f0",fontWeight:isLow?700:400}}>{item.qty} {item.unit}</td>
                      <td style={{color:"#4ade80",fontWeight:600}}>{fmt(item.sellingPrice)}</td>
                      <td style={{color:isExp?"#f87171":isWarn?"#fb923c":"#64748b",fontSize:12}}>{item.expiry}{isExp?" ⛔":isWarn?" ⚠":""}</td>
                      <td>{isExp?<span className="badge be">Expired</span>:isLow?<span className="badge bw">Low</span>:isWarn?<span className="badge" style={{background:"#451a03",color:"#fbbf24"}}>Exp Soon</span>:<span className="badge bsuc">Good</span>}</td>
                      {isOwner&&<td><div style={{display:"flex",gap:6}}>
                        <button className="btn bg" style={{padding:"4px 9px"}} onClick={()=>openEdit(item)}><Ic d={I.edit} size={12}/></button>
                        <button className="btn bd" style={{padding:"4px 9px"}} onClick={()=>handleDel(item)}><Ic d={I.trash} size={12}/></button>
                      </div></td>}
                    </tr>
                  );
                })
            }
          </tbody>
        </table>
      </div>

      {modal&&(
        <div className="mo" onClick={e=>e.target===e.currentTarget&&setModal(false)}>
          <div className="md">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <h3 style={{fontFamily:"Syne,sans-serif",fontSize:16,fontWeight:800,color:"#f1f5f9"}}>{editing?"Edit Drug":"Add New Drug"}</h3>
                {!editing&&form.name&&<div style={{fontSize:11,color:"#a78bfa",marginTop:2}}>✨ AI pre-filled — verify all fields before saving</div>}
              </div>
              <button className="btn bg" style={{padding:"4px 7px"}} onClick={()=>setModal(false)}><Ic d={I.x} size={13}/></button>
            </div>
            <div className="fg"><label>Drug Name *</label><input className="inp" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div>
            <div className="fr">
              <div className="fg"><label>Category</label><select className="inp" value={form.category} onChange={e=>setForm({...form,category:e.target.value})}><option>OTC</option><option>Prescription</option></select></div>
              <div className="fg"><label>Unit</label><select className="inp" value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})}><option>Tabs</option><option>Caps</option><option>Bottles</option><option>Vials</option><option>Sachets</option><option>Pieces</option></select></div>
            </div>
            <div className="fr">
              <div className="fg"><label>Quantity *</label><input className="inp" type="number" value={form.qty} onChange={e=>setForm({...form,qty:+e.target.value})}/></div>
              <div className="fg"><label>Reorder Level</label><input className="inp" type="number" value={form.reorderLevel} onChange={e=>setForm({...form,reorderLevel:+e.target.value})}/></div>
            </div>
            <div className="fr">
              <div className="fg"><label>Cost Price (₦)</label><input className="inp" type="number" value={form.costPrice} onChange={e=>setForm({...form,costPrice:+e.target.value})}/></div>
              <div className="fg"><label>Selling Price (₦) *</label><input className="inp" type="number" value={form.sellingPrice} onChange={e=>setForm({...form,sellingPrice:+e.target.value})}/></div>
            </div>
            <div className="fr">
              <div className="fg"><label>Expiry Date</label><input className="inp" type="date" value={form.expiry} onChange={e=>setForm({...form,expiry:e.target.value})}/></div>
              <div className="fg"><label>Supplier</label><input className="inp" value={form.supplier} onChange={e=>setForm({...form,supplier:e.target.value})}/></div>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:6}}>
              <button className="btn bg" onClick={()=>setModal(false)}>Cancel</button>
              <button className="btn bs" onClick={handleSave}><Ic d={I.check} size={13}/> {editing?"Save Changes":"Add Drug"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  SALES — with auto receipt
// ═══════════════════════════════════════════════════════════════════
function Sales({data, session, save, addLog, showToast, role}){
  const [modal,setModal]         = useState(false);
  const [receiptSale,setReceipt] = useState(null);
  const [form,setForm]           = useState({type:"OTC",customer:"",date:now(),items:[],notes:""});
  const [cart,setCart]           = useState({drugId:"",qty:1});
  const selDrug = data.inventory.find(d=>d.id===cart.drugId);
  const total   = form.items.reduce((a,i)=>a+i.subtotal,0);

  const addCart = () => {
    if(!cart.drugId) return;
    const drug = data.inventory.find(d=>d.id===cart.drugId);
    if(!drug) return;
    if(+cart.qty>drug.qty) return showToast("Insufficient stock","error");
    const ex = form.items.findIndex(i=>i.drugId===cart.drugId);
    if(ex>-1){
      const items=[...form.items]; items[ex].qty+=+cart.qty; items[ex].subtotal=items[ex].qty*items[ex].price;
      setForm({...form,items});
    } else {
      setForm({...form,items:[...form.items,{drugId:drug.id,name:drug.name,price:drug.sellingPrice,qty:+cart.qty,subtotal:drug.sellingPrice*+cart.qty}]});
    }
    setCart({drugId:"",qty:1});
  };

  const doSale = () => {
    if(form.items.length===0) return showToast("Add at least one item","error");
    const sale = {id:uid(),...form,total,recordedBy:session.name,recordedById:session.id,timestamp:Date.now()};
    const newInv = data.inventory.map(drug=>{
      const item=form.items.find(i=>i.drugId===drug.id);
      return item?{...drug,qty:drug.qty-item.qty}:drug;
    });
    const [d2,entry] = addLog({...data,sales:[...data.sales,sale],inventory:newInv}, "SALE_RECORDED", `${fmt(total)} by ${session.name}`, session);
    save(d2,{inventory:true,sale:sale,auditEntry:entry});
    setModal(false);
    setReceipt(sale);
    setForm({type:"OTC",customer:"",date:now(),items:[],notes:""});
    showToast("Sale recorded! Receipt ready to print.");
  };

  return(
    <div>
      {receiptSale&&<ReceiptModal sale={receiptSale} settings={data.settings} onClose={()=>setReceipt(null)}/>}

      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:16}}>
        <button className="btn bs" onClick={()=>setModal(true)}><Ic d={I.plus} size={13}/> New Sale</button>
      </div>

      <div className="card" style={{padding:0}}>
        <table className="tbl">
          <thead><tr><th>Date</th><th>Items</th><th>Type</th><th>Customer</th><th>By</th>{role==="owner"&&<th>Total</th>}<th>Receipt</th></tr></thead>
          <tbody>
            {data.sales.length===0
              ? <tr><td colSpan={7} style={{textAlign:"center",padding:32,color:"#334155"}}>No sales yet</td></tr>
              : [...data.sales].reverse().map(s=>(
                <tr key={s.id}>
                  <td style={{color:"#64748b"}}>{s.date}</td>
                  <td>{s.items.map(i=><div key={i.drugId} style={{fontSize:12,color:"#e2e8f0"}}>{i.name} × {i.qty}</div>)}</td>
                  <td><span className={`badge ${s.type==="OTC"?"bo":"brx"}`}>{s.type}</span></td>
                  <td style={{color:"#64748b",fontSize:12}}>{s.customer||"Walk-in"}</td>
                  <td style={{color:"#a78bfa",fontSize:12}}>{s.recordedBy||"—"}</td>
                  {role==="owner"&&<td style={{color:"#4ade80",fontWeight:700}}>{fmt(s.total)}</td>}
                  <td><button className="btn bg" style={{padding:"4px 9px",fontSize:11}} onClick={()=>setReceipt(s)}><Ic d={I.print} size={12}/></button></td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      {modal&&(
        <div className="mo" onClick={e=>e.target===e.currentTarget&&setModal(false)}>
          <div className="md" style={{width:560}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <h3 style={{fontFamily:"Syne,sans-serif",fontSize:16,fontWeight:800,color:"#f1f5f9"}}>Record New Sale</h3>
              <button className="btn bg" style={{padding:"4px 7px"}} onClick={()=>setModal(false)}><Ic d={I.x} size={13}/></button>
            </div>
            <div style={{fontSize:12,background:"#0a1525",borderRadius:8,padding:"7px 12px",marginBottom:12,color:"#475569"}}>
              Recording as: <strong style={{color:"#a78bfa"}}>{session.name}</strong>
            </div>
            <div className="fr">
              <div className="fg"><label>Sale Type</label><select className="inp" value={form.type} onChange={e=>setForm({...form,type:e.target.value})}><option>OTC</option><option>Prescription</option></select></div>
              <div className="fg"><label>Date</label><input className="inp" type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></div>
            </div>
            <div className="fg"><label>Customer Name (optional)</label><input className="inp" placeholder="Walk-in" value={form.customer} onChange={e=>setForm({...form,customer:e.target.value})}/></div>
            <div style={{background:"#0a1525",border:"1px solid #1e3a5f",borderRadius:10,padding:14,marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:700,color:"#475569",marginBottom:10,textTransform:"uppercase",letterSpacing:".05em"}}>Add to Cart</div>
              <div style={{display:"flex",gap:8}}>
                <div style={{flex:2}}>
                  <select className="inp" value={cart.drugId} onChange={e=>setCart({...cart,drugId:e.target.value})}>
                    <option value="">Select drug...</option>
                    {data.inventory.filter(d=>d.qty>0&&days(d.expiry)>0).map(d=><option key={d.id} value={d.id}>{d.name} — Stock: {d.qty} {d.unit}</option>)}
                  </select>
                </div>
                <input className="inp" type="number" min={1} value={cart.qty} onChange={e=>setCart({...cart,qty:+e.target.value})} style={{width:70}}/>
                <button className="btn bp" onClick={addCart}>Add</button>
              </div>
              {selDrug&&<div style={{fontSize:11,color:"#38bdf8",marginTop:6}}>Unit price: {fmt(selDrug.sellingPrice)} · Subtotal: {fmt(selDrug.sellingPrice*cart.qty)}</div>}
            </div>
            {form.items.length>0&&(
              <div style={{marginBottom:12}}>
                {form.items.map((item,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:"1px solid #1e2d45"}}>
                    <span style={{fontSize:13,color:"#e2e8f0"}}>{item.name} × {item.qty}</span>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <span style={{color:"#4ade80",fontWeight:700}}>{fmt(item.subtotal)}</span>
                      <button className="btn bd" style={{padding:"3px 7px"}} onClick={()=>setForm({...form,items:form.items.filter((_,j)=>j!==i)})}><Ic d={I.trash} size={11}/></button>
                    </div>
                  </div>
                ))}
                <div style={{textAlign:"right",marginTop:8,fontSize:17,fontWeight:800,color:"#4ade80"}}>Total: {fmt(total)}</div>
              </div>
            )}
            <div className="fg"><label>Notes (prescription no., etc.)</label><textarea className="inp" rows={2} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Optional notes..."/></div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button className="btn bg" onClick={()=>setModal(false)}>Cancel</button>
              <button className="btn bs" onClick={doSale}><Ic d={I.check} size={13}/> Complete Sale & Print Receipt</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  RECORDS
// ═══════════════════════════════════════════════════════════════════
function Records({data, session, save, addLog, showToast}){
  const [modal,setModal]     = useState(false);
  const [search,setSearch]   = useState("");
  const [editing,setEditing] = useState(null);
  const E = {name:"",phone:"",address:"",dob:"",allergies:"",notes:""};
  const [form,setForm] = useState(E);
  const filtered = data.customers.filter(c=>c.name.toLowerCase().includes(search.toLowerCase())||c.phone?.includes(search));

  const handleSave = () => {
    if(!form.name) return showToast("Customer name is required","error");
    const customers = editing
      ? data.customers.map(c=>c.id===editing?{...form,id:editing}:c)
      : [...data.customers,{...form,id:uid(),createdAt:now()}];
    const [d2c,ec] = addLog({...data,customers}, editing?"CUSTOMER_UPDATE":"CUSTOMER_ADD", `${editing?"Updated":"Added"}: ${form.name}`, session);
    save(d2c,{customers:true,auditEntry:ec});
    showToast(editing?"Record updated":"Customer added"); setModal(false);
  };

  return(
    <div>
      <div style={{display:"flex",gap:10,marginBottom:16,alignItems:"center"}}>
        <input className="inp" style={{maxWidth:280}} placeholder="Search by name or phone..." value={search} onChange={e=>setSearch(e.target.value)}/>
        <button className="btn bs" style={{marginLeft:"auto"}} onClick={()=>{setForm(E);setEditing(null);setModal(true)}}><Ic d={I.plus} size={13}/> Add Customer</button>
      </div>
      <div className="card" style={{padding:0}}>
        <table className="tbl">
          <thead><tr><th>Name</th><th>Phone</th><th>Added</th><th>Visits</th><th>Allergies</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.length===0
              ? <tr><td colSpan={6} style={{textAlign:"center",padding:32,color:"#334155"}}>No records found</td></tr>
              : filtered.map(c=>{
                  const visits = data.sales.filter(s=>s.customer===c.name).length;
                  return(
                    <tr key={c.id}>
                      <td style={{fontWeight:600,color:"#f1f5f9"}}>{c.name}</td>
                      <td style={{color:"#64748b"}}>{c.phone||"—"}</td>
                      <td style={{color:"#475569",fontSize:12}}>{c.createdAt}</td>
                      <td style={{color:"#38bdf8",fontWeight:700}}>{visits}</td>
                      <td style={{color:c.allergies?"#fb923c":"#334155",fontSize:12}}>{c.allergies||"None"}</td>
                      <td><button className="btn bg" style={{padding:"4px 9px"}} onClick={()=>{setForm({...c});setEditing(c.id);setModal(true)}}><Ic d={I.edit} size={12}/></button></td>
                    </tr>
                  );
                })
            }
          </tbody>
        </table>
      </div>

      {modal&&(
        <div className="mo" onClick={e=>e.target===e.currentTarget&&setModal(false)}>
          <div className="md">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <h3 style={{fontFamily:"Syne,sans-serif",fontSize:16,fontWeight:800,color:"#f1f5f9"}}>{editing?"Edit Record":"New Customer"}</h3>
              <button className="btn bg" style={{padding:"4px 7px"}} onClick={()=>setModal(false)}><Ic d={I.x} size={13}/></button>
            </div>
            <div className="fr">
              <div className="fg"><label>Full Name *</label><input className="inp" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div>
              <div className="fg"><label>Phone Number</label><input className="inp" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></div>
            </div>
            <div className="fr">
              <div className="fg"><label>Date of Birth</label><input className="inp" type="date" value={form.dob} onChange={e=>setForm({...form,dob:e.target.value})}/></div>
              <div className="fg"><label>Address</label><input className="inp" value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></div>
            </div>
            <div className="fg"><label>Known Allergies</label><input className="inp" placeholder="e.g. Penicillin, Sulfa drugs..." value={form.allergies} onChange={e=>setForm({...form,allergies:e.target.value})}/></div>
            <div className="fg"><label>Medical Notes</label><textarea className="inp" rows={2} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button className="btn bg" onClick={()=>setModal(false)}>Cancel</button>
              <button className="btn bs" onClick={handleSave}><Ic d={I.check} size={13}/> Save Record</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  REPORTS
// ═══════════════════════════════════════════════════════════════════
function Reports({data}){
  const [period,setPeriod] = useState("30");
  const filtered = data.sales.filter(s=>{const d=new Date(s.date),c=new Date();c.setDate(c.getDate()-+period);return d>=c;});
  const revenue  = filtered.reduce((a,s)=>a+s.total,0);
  const cost     = filtered.reduce((a,s)=>a+s.items.reduce((b,i)=>{const dr=data.inventory.find(d=>d.id===i.drugId);return b+(dr?dr.costPrice*i.qty:0);},0),0);
  const drugSales= {};
  filtered.forEach(s=>s.items.forEach(i=>{drugSales[i.name]=(drugSales[i.name]||0)+i.qty;}));
  const top      = Object.entries(drugSales).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const byDay    = {};
  filtered.forEach(s=>{byDay[s.date]=(byDay[s.date]||0)+s.total;});
  const maxDay   = Math.max(...Object.values(byDay),1);
  const bySelf   = {};
  filtered.forEach(s=>{bySelf[s.recordedBy||"Unknown"]=(bySelf[s.recordedBy||"Unknown"]||0)+s.total;});

  return(
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {[["7","7 Days"],["30","30 Days"],["90","90 Days"],["365","1 Year"]].map(([v,l])=>(
          <button key={v} className={`btn ${period===v?"bp":"bg"}`} style={{padding:"6px 14px"}} onClick={()=>setPeriod(v)}>{l}</button>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>
        {[{l:"Revenue",v:fmt(revenue),c:"#4ade80"},{l:"Est. Profit",v:fmt(revenue-cost),c:"#38bdf8"},{l:"Transactions",v:filtered.length,c:"#a78bfa"},{l:"Drugs Sold",v:Object.keys(drugSales).length,c:"#fb923c"}].map((s,i)=>(
          <div key={i} style={{background:"linear-gradient(135deg,#0d1528,#0d1f3c)",border:"1px solid #1e3a5f",borderRadius:14,padding:18}}>
            <div style={{fontSize:22,fontWeight:800,color:s.c}}>{s.v}</div>
            <div style={{fontSize:12,color:"#475569",marginTop:4}}>{s.l}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:16}}>
        <div className="card">
          <div style={{fontSize:14,fontWeight:700,color:"#f1f5f9",marginBottom:14}}>Daily Revenue</div>
          {Object.keys(byDay).length===0
            ? <div style={{color:"#334155",fontSize:13}}>No data for this period</div>
            : Object.entries(byDay).sort((a,b)=>a[0].localeCompare(b[0])).slice(-14).map(([d,v])=>(
              <div key={d} style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                <div style={{width:72,fontSize:11,color:"#475569",flexShrink:0}}>{d.slice(5)}</div>
                <div style={{flex:1,background:"#0a1525",borderRadius:4,height:18,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${(v/maxDay)*100}%`,background:"linear-gradient(90deg,#0369a1,#38bdf8)",borderRadius:4}}/>
                </div>
                <div style={{width:80,fontSize:11,color:"#4ade80",textAlign:"right",fontWeight:700}}>{fmt(v)}</div>
              </div>
            ))
          }
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div className="card">
            <div style={{fontSize:14,fontWeight:700,color:"#f1f5f9",marginBottom:10}}>Top Drugs</div>
            {top.length===0
              ? <div style={{color:"#334155",fontSize:12}}>No data</div>
              : top.map(([n,q])=><div key={n} style={{display:"flex",justifyContent:"space-between",marginBottom:7,fontSize:12}}><span style={{color:"#94a3b8"}}>{n.slice(0,22)}</span><span style={{color:"#38bdf8",fontWeight:700}}>{q}u</span></div>)
            }
          </div>
          <div className="card">
            <div style={{fontSize:14,fontWeight:700,color:"#f1f5f9",marginBottom:10}}>Revenue by Staff</div>
            {Object.keys(bySelf).length===0
              ? <div style={{color:"#334155",fontSize:12}}>No data</div>
              : Object.entries(bySelf).map(([name,rev])=><div key={name} style={{display:"flex",justifyContent:"space-between",marginBottom:7,fontSize:12}}><span style={{color:"#94a3b8"}}>{name}</span><span style={{color:"#a78bfa",fontWeight:700}}>{fmt(rev)}</span></div>)
            }
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  AI ASSISTANT
// ═══════════════════════════════════════════════════════════════════
function AIAssistant({data, session}){
  const [msgs,setMsgs]       = useState([]);
  const [input,setInput]     = useState("");
  const [busy,setBusy]       = useState(false);
  const [insights,setIns]    = useState(null);
  const [insLoading,setIL]   = useState(false);

  const buildCtx = () => {
    const ds={};
    data.sales.forEach(s=>s.items.forEach(i=>{ds[i.name]=(ds[i.name]||0)+i.qty;}));
    const low     = data.inventory.filter(d=>d.qty<=d.reorderLevel);
    const exp     = data.inventory.filter(d=>days(d.expiry)<=60&&days(d.expiry)>0);
    const expired = data.inventory.filter(d=>days(d.expiry)<=0);
    const rev     = data.sales.reduce((a,s)=>a+s.total,0);
    return `You are the business AI for ${data.settings?.pharmacyName||"Dorzy Health Care/Minimart"}, a Nigerian pharmacy.
INVENTORY(${data.inventory.length}): ${data.inventory.map(d=>`${d.name}(${d.category}):${d.qty}${d.unit},₦${d.sellingPrice},exp${d.expiry},reorder@${d.reorderLevel}`).join("|")}
LOW STOCK: ${low.map(d=>d.name).join(",")||"None"}
EXPIRING(<60d): ${exp.map(d=>`${d.name}(${days(d.expiry)}d)`).join(",")||"None"}
EXPIRED: ${expired.map(d=>d.name).join(",")||"None"}
SALES(${data.sales.length} total, ₦${rev.toLocaleString()}): ${data.sales.slice(-10).map(s=>`${s.date}:${s.items.map(i=>`${i.name}×${i.qty}`).join(",")},₦${s.total},by:${s.recordedBy}`).join("|")||"None"}
TOP SELLERS: ${Object.entries(ds).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([n,q])=>`${n}:${q}units`).join(",")||"None"}
Be concise, practical, use ₦ for prices. Address owner as ${session.name}.`;
  };

  const genInsights = async() => {
    setIL(true);
    try{
      const r = await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json","anthropic-dangerous-direct-browser-access":"true"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:900,system:buildCtx(),messages:[{role:"user",content:"Give a daily business intelligence summary: 1) Urgent actions needed right now 2) Top restock recommendations 3) Revenue insight 4) One smart growth tip for this pharmacy. Be specific and concise."}]})
      });
      const d = await r.json(); setIns(d.content[0].text);
    }catch{ setIns("Connection error. AI features require internet access."); }
    setIL(false);
  };

  const sendMsg = async() => {
    if(!input.trim()) return;
    const um = {role:"user",content:input};
    const nm = [...msgs,um];
    setMsgs(nm); setInput(""); setBusy(true);
    try{
      const r = await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json","anthropic-dangerous-direct-browser-access":"true"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:800,system:buildCtx(),messages:nm})
      });
      const d = await r.json(); setMsgs([...nm,{role:"assistant",content:d.content[0].text}]);
    }catch{ setMsgs([...nm,{role:"assistant",content:"Connection error. Please check your internet and try again."}]); }
    setBusy(false);
  };

  if(!AI_ENABLED) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:400,gap:20}}>
      <div style={{fontSize:56}}>🤖</div>
      <div style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:800,color:"#f1f5f9",textAlign:"center"}}>AI Features — Premium</div>
      <div style={{fontSize:14,color:"#475569",textAlign:"center",maxWidth:380,lineHeight:1.7}}>
        The AI Assistant, Daily Insights and Scan-to-Add features are available on the Premium plan.
        Contact your system provider to upgrade and unlock intelligent pharmacy management.
      </div>
      <div style={{background:"linear-gradient(135deg,#0d1b3e,#1a0533)",border:"1px solid #2d1b69",borderRadius:16,padding:20,maxWidth:380,width:"100%"}}>
        <div style={{fontSize:13,fontWeight:700,color:"#a78bfa",marginBottom:12}}>✨ Premium includes:</div>
        {[["🤖","AI Business Assistant","Ask questions about your pharmacy in plain English"],
          ["📊","Daily Intelligence Report","Automatic insights on sales, stock and growth"],
          ["📷","Scan to Add","Point camera at drug label — AI fills details instantly"],
        ].map(([ic,t,d])=>(
          <div key={t} style={{display:"flex",gap:12,marginBottom:12}}>
            <div style={{fontSize:20,flexShrink:0}}>{ic}</div>
            <div><div style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>{t}</div><div style={{fontSize:11,color:"#475569"}}>{d}</div></div>
          </div>
        ))}
      </div>
      <div style={{fontSize:12,color:"#334155",textAlign:"center"}}>Contact your system provider to activate Premium</div>
    </div>
  );

  return(
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <div style={{background:"linear-gradient(135deg,#0d1b3e,#1a0533)",border:"1px solid #2d1b69",borderRadius:16,padding:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Ic d={I.spark} size={20} color="#a78bfa"/>
            <div>
              <div style={{fontFamily:"Syne,sans-serif",fontSize:15,fontWeight:800,color:"#f1f5f9"}}>Daily Intelligence Report</div>
              <div style={{fontSize:12,color:"#4b5563"}}>AI analysis of your live pharmacy data</div>
            </div>
          </div>
          <button className="btn bp" onClick={genInsights} disabled={insLoading}>
            {insLoading?<span className="pulse">Analysing...</span>:<><Ic d={I.spark} size={13}/> Generate</>}
          </button>
        </div>
        {insights
          ? <div className="fi" style={{fontSize:13,color:"#cbd5e1",lineHeight:1.8,background:"#07101f",borderRadius:10,padding:16,whiteSpace:"pre-wrap"}}>{insights}</div>
          : <div style={{color:"#2d3748",fontSize:13,textAlign:"center",padding:"18px 0"}}>Click Generate to get today's business insights</div>
        }
      </div>

      <div className="card" style={{padding:0}}>
        <div style={{padding:"14px 18px",borderBottom:"1px solid #1e2d45",display:"flex",alignItems:"center",gap:10}}>
          <Ic d={I.brain} size={17} color="#38bdf8"/>
          <div style={{fontFamily:"Syne,sans-serif",fontSize:14,fontWeight:800,color:"#f1f5f9"}}>Chat with Dorzy AI</div>
          <div style={{marginLeft:"auto",fontSize:11,color:"#334155"}}>Ask anything about your pharmacy</div>
        </div>
        {msgs.length===0&&(
          <div style={{padding:14}}>
            <div style={{fontSize:11,color:"#334155",fontWeight:700,textTransform:"uppercase",letterSpacing:".05em",marginBottom:10}}>Quick Questions</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
              {["What should I restock urgently?","Which drugs are slow-moving?","Revenue this week?","What's expiring soon?","Which staff sold the most?"].map(q=>(
                <button key={q} className="btn bg" style={{fontSize:12,padding:"5px 11px"}} onClick={()=>setInput(q)}>{q}</button>
              ))}
            </div>
          </div>
        )}
        <div style={{maxHeight:320,overflowY:"auto",padding:"0 18px"}}>
          {msgs.map((m,i)=>(
            <div key={i} className="fi" style={{padding:"12px 0",borderBottom:i<msgs.length-1?"1px solid #0d1f3c":"none"}}>
              <div style={{fontSize:11,fontWeight:700,color:m.role==="user"?"#38bdf8":"#a78bfa",marginBottom:5,textTransform:"uppercase"}}>
                {m.role==="user"?`👩‍⚕️ ${session.name}`:"🤖 AI Assistant"}
              </div>
              <div style={{fontSize:13,color:"#cbd5e1",lineHeight:1.7,whiteSpace:"pre-wrap"}}>{m.content}</div>
            </div>
          ))}
          {busy&&(
            <div style={{padding:"12px 0"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#a78bfa",marginBottom:5}}>🤖 AI Assistant</div>
              <div className="pulse" style={{fontSize:13,color:"#334155"}}>Thinking...</div>
            </div>
          )}
        </div>
        <div style={{padding:14,borderTop:"1px solid #1e2d45",display:"flex",gap:10}}>
          <input className="inp" placeholder="Ask about stock, revenue, trends..." value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!busy&&sendMsg()}/>
          <button className="btn bp" onClick={sendMsg} disabled={busy||!input.trim()}><Ic d={I.send} size={13}/></button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════
function UserMgmt({data, session, save, addLog, showToast}){
  const [modal,setModal]     = useState(false);
  const [editing,setEditing] = useState(null);
  const [showPw,setShowPw]   = useState(false);
  const E = {name:"",email:"",password:"",role:"staff",avatar:"🧑‍💼",active:true};
  const [form,setForm] = useState(E);
  const avatars = ["👩‍⚕️","🧑‍💼","👨‍⚕️","👩‍💼","🧑‍🔬","👨‍💼"];

  const handleSave = () => {
    if(!form.name||!form.email) return showToast("Name and email are required","error");
    if(!editing&&!form.password) return showToast("Password is required for new users","error");
    if(data.users.some(u=>u.email===form.email&&u.id!==editing)) return showToast("This email is already in use","error");
    const users = editing
      ? data.users.map(u=>u.id===editing?{...u,...form,password:form.password||u.password}:u)
      : [...data.users,{...form,id:uid(),createdAt:now()}];
    const [d2u,eu] = addLog({...data,users}, editing?"USER_UPDATE":"USER_ADD", `${editing?"Updated":"Added"}: ${form.name} (${form.role})`, session);
    save(d2u,{users:true,auditEntry:eu});
    showToast(editing?"User updated":"New user added"); setModal(false);
  };

  const toggleActive = (user) => {
    if(user.id===session.id) return showToast("You cannot deactivate your own account","error");
    const users = data.users.map(u=>u.id===user.id?{...u,active:!u.active}:u);
    const [d2t,et] = addLog({...data,users}, "USER_STATUS", `${user.active?"Deactivated":"Activated"}: ${user.name}`, session);
    save(d2t,{users:true,auditEntry:et});
    showToast(`User ${user.active?"deactivated":"activated"}`);
  };

  return(
    <div>
      <div style={{background:"linear-gradient(135deg,#0c1a3a,#0d1b3e)",border:"1px solid #1e3a5f",borderRadius:14,padding:"14px 18px",marginBottom:18,display:"flex",alignItems:"center",gap:14}}>
        <Ic d={I.shield} size={22} color="#38bdf8"/>
        <div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0"}}>Role-Based Access Control is Active</div>
          <div style={{fontSize:12,color:"#475569"}}>Owner: full access to all modules. Staff: Dashboard, Inventory (view only), Sales, Customer Records.</div>
        </div>
        <button className="btn bs" onClick={()=>{setForm(E);setEditing(null);setModal(true)}}><Ic d={I.plus} size={13}/> Add User</button>
      </div>

      <div className="card" style={{padding:0}}>
        <table className="tbl">
          <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead>
          <tbody>{data.users.map(u=>(
            <tr key={u.id}>
              <td>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:22}}>{u.avatar}</span>
                  <div>
                    <div style={{fontWeight:700,color:"#f1f5f9",fontSize:13}}>{u.name}</div>
                    {u.id===session.id&&<div style={{fontSize:10,color:"#4ade80"}}>● You</div>}
                  </div>
                </div>
              </td>
              <td style={{color:"#64748b",fontSize:12}}>{u.email}</td>
              <td><span className={`role-${u.role}`}>{u.role}</span></td>
              <td>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:u.active?"#4ade80":"#ef4444"}}/>
                  <span style={{fontSize:12,color:u.active?"#4ade80":"#ef4444"}}>{u.active?"Active":"Inactive"}</span>
                </div>
              </td>
              <td style={{color:"#475569",fontSize:12}}>{u.createdAt}</td>
              <td>
                <div style={{display:"flex",gap:6}}>
                  <button className="btn bg" style={{padding:"4px 9px"}} onClick={()=>{setForm({...u,password:""});setEditing(u.id);setModal(true)}}><Ic d={I.edit} size={12}/></button>
                  {u.id!==session.id&&<button className={`btn ${u.active?"bd":"bs"}`} style={{padding:"4px 9px",fontSize:11}} onClick={()=>toggleActive(u)}>{u.active?"Deactivate":"Activate"}</button>}
                </div>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      {modal&&(
        <div className="mo" onClick={e=>e.target===e.currentTarget&&setModal(false)}>
          <div className="md">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <h3 style={{fontFamily:"Syne,sans-serif",fontSize:16,fontWeight:800,color:"#f1f5f9"}}>{editing?"Edit User":"Add New User"}</h3>
              <button className="btn bg" style={{padding:"4px 7px"}} onClick={()=>setModal(false)}><Ic d={I.x} size={13}/></button>
            </div>
            <div className="fg">
              <label>Choose Avatar</label>
              <div style={{display:"flex",gap:8}}>
                {avatars.map(a=><button key={a} onClick={()=>setForm({...form,avatar:a})} style={{fontSize:22,background:form.avatar===a?"#1e3a5f":"#0a1525",border:`2px solid ${form.avatar===a?"#38bdf8":"#1e2d45"}`,borderRadius:10,padding:"5px 9px",cursor:"pointer"}}>{a}</button>)}
              </div>
            </div>
            <div className="fr">
              <div className="fg"><label>Full Name *</label><input className="inp" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div>
              <div className="fg"><label>Role *</label><select className="inp" value={form.role} onChange={e=>setForm({...form,role:e.target.value})}><option value="staff">Staff</option><option value="owner">Owner</option></select></div>
            </div>
            <div className="fg"><label>Email Address *</label><input className="inp" type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></div>
            <div className="fg">
              <label>{editing?"New Password (leave blank to keep current)":"Password *"}</label>
              <div style={{position:"relative"}}>
                <input className="inp" type={showPw?"text":"password"} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder={editing?"Leave blank to keep current":"Set a password"} style={{paddingRight:44}}/>
                <button onClick={()=>setShowPw(!showPw)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#475569",cursor:"pointer"}}><Ic d={I.eye} size={15}/></button>
              </div>
            </div>
            <div style={{background:"#0a1525",border:"1px solid #1e3a5f",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#475569"}}>
              <strong style={{color:form.role==="owner"?"#60a5fa":"#a78bfa"}}>{form.role==="owner"?"👑 Owner — ":"🧑‍💼 Staff — "}</strong>
              {form.role==="owner"?"Full access to all modules including financials, reports, AI, user management and settings."
                :"Can record sales, view inventory, and manage customer records. No financial data or admin access."}
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button className="btn bg" onClick={()=>setModal(false)}>Cancel</button>
              <button className="btn bs" onClick={handleSave}><Ic d={I.check} size={13}/> {editing?"Save Changes":"Add User"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  AUDIT LOG
// ═══════════════════════════════════════════════════════════════════
function AuditLog({data}){
  const [filter,setFilter] = useState("ALL");
  const types = ["ALL","LOGIN","SALE_RECORDED","INVENTORY_ADD","INVENTORY_UPDATE","USER_ADD","USER_STATUS"];
  const filtered = (data.auditLog||[]).filter(e=>filter==="ALL"||e.action===filter);
  const colors = {LOGIN:"#38bdf8",LOGOUT:"#64748b",SALE_RECORDED:"#4ade80",INVENTORY_ADD:"#a78bfa",INVENTORY_UPDATE:"#fb923c",INVENTORY_DELETE:"#f87171",USER_ADD:"#34d399",USER_UPDATE:"#60a5fa",USER_STATUS:"#fbbf24",CUSTOMER_ADD:"#a78bfa",SETTINGS_UPDATE:"#94a3b8"};

  return(
    <div>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {types.map(t=><button key={t} className={`btn ${filter===t?"bp":"bg"}`} style={{padding:"5px 12px",fontSize:11}} onClick={()=>setFilter(t)}>{t.replace(/_/g," ")}</button>)}
      </div>
      <div className="card" style={{padding:0}}>
        <table className="tbl">
          <thead><tr><th>Timestamp</th><th>Action</th><th>Detail</th><th>User</th><th>Role</th></tr></thead>
          <tbody>
            {filtered.length===0
              ? <tr><td colSpan={5} style={{textAlign:"center",padding:32,color:"#334155"}}>No log entries yet. Actions appear here as they happen.</td></tr>
              : filtered.map(e=>(
                <tr key={e.id}>
                  <td style={{color:"#475569",fontSize:11,whiteSpace:"nowrap"}}>{e.timestamp}</td>
                  <td><span style={{fontSize:11,fontWeight:700,color:colors[e.action]||"#94a3b8",background:"rgba(0,0,0,.3)",padding:"2px 8px",borderRadius:6}}>{e.action}</span></td>
                  <td style={{color:"#94a3b8",fontSize:12}}>{e.detail}</td>
                  <td style={{color:"#e2e8f0",fontSize:12,fontWeight:600}}>{e.user}</td>
                  <td><span className={`role-${e.role}`}>{e.role}</span></td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
      <div style={{marginTop:10,fontSize:12,color:"#334155",textAlign:"center"}}>Showing last {filtered.length} entries. Log retains up to 300 entries.</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  SETTINGS — FIX: updates session name instantly on save
// ═══════════════════════════════════════════════════════════════════
function Settings({data, session, save, addLog, showToast, updateSession}){
  const [form,setForm] = useState({...data.settings});

  const handleSave = () => {
    // ── FIX: if owner name changed, update the live session immediately ──
    if(session.role==="owner" && form.ownerName !== session.name){
      updateSession({name: form.ownerName});
    }
    // Also update matching user record in users list
    const users = data.users.map(u=>
      u.id===session.id ? {...u, name:form.ownerName} : u
    );
    const [d2s,es] = addLog({...data, settings:form, users}, "SETTINGS_UPDATE", "Pharmacy settings updated", session);
    save(d2s,{settings:true,users:true,auditEntry:es});
    showToast("Settings saved successfully");
  };

  return(
    <div style={{maxWidth:620,display:"flex",flexDirection:"column",gap:16}}>
      <div className="card">
        <div style={{fontFamily:"Syne,sans-serif",fontSize:14,fontWeight:800,color:"#f1f5f9",marginBottom:16}}>Pharmacy Details</div>
        <div className="fr">
          <div className="fg"><label>Pharmacy Name</label><input className="inp" value={form.pharmacyName} onChange={e=>setForm({...form,pharmacyName:e.target.value})}/></div>
          <div className="fg"><label>Owner Name</label><input className="inp" value={form.ownerName} onChange={e=>setForm({...form,ownerName:e.target.value})}/></div>
        </div>
        <div className="fr">
          <div className="fg"><label>Phone Number</label><input className="inp" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></div>
          <div className="fg"><label>Email Address</label><input className="inp" type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></div>
        </div>
        <div className="fg"><label>Address</label><textarea className="inp" rows={2} value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></div>
        <div style={{marginTop:6,padding:"10px 14px",background:"#0a1525",borderRadius:10,fontSize:12,color:"#475569",marginBottom:14}}>
          💡 Pharmacy name and address appear on every printed receipt.
        </div>
        <button className="btn bs" onClick={handleSave}><Ic d={I.check} size={13}/> Save Settings</button>
      </div>

      <div className="card">
        <div style={{fontFamily:"Syne,sans-serif",fontSize:14,fontWeight:800,color:"#f1f5f9",marginBottom:14}}>System Overview</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {[{l:"Drugs in Stock",v:data.inventory.length,c:"#38bdf8"},{l:"Total Sales",v:data.sales.length,c:"#4ade80"},{l:"Customers",v:data.customers.length,c:"#a78bfa"},{l:"System Users",v:data.users?.length||0,c:"#fb923c"},{l:"Audit Entries",v:data.auditLog?.length||0,c:"#fbbf24"},{l:"Version",v:"v4.0",c:"#64748b"}].map((s,i)=>(
            <div key={i} style={{background:"#0a1525",borderRadius:10,padding:"12px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:12,color:"#475569"}}>{s.l}</span>
              <span style={{fontWeight:700,color:s.c}}>{s.v}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{background:"linear-gradient(135deg,#0c1a3a,#0d1528)",border:"1px solid #1e3a5f",borderRadius:14,padding:"16px 20px"}}>
        <div style={{fontFamily:"Syne,sans-serif",fontSize:13,fontWeight:800,color:"#38bdf8",marginBottom:12,display:"flex",alignItems:"center",gap:8}}><Ic d={I.shield} size={15}/> Supabase Deployment Checklist</div>
        {[
          ["Create Supabase project","supabase.com → New Project → choose Nigeria/closest region"],
          ["Set up database tables","inventory, sales, customers, users, audit_log"],
          ["Enable Row Level Security","Protect each user's data from other users"],
          ["Configure Auth","Email/password auth — Supabase handles passwords securely"],
          ["Replace DB functions","Swap window.storage calls for supabase.from(...)"],
          ["Deploy to Vercel","Connect GitHub repo → Vercel → auto-deploys on every update"],
        ].map(([step,detail],i)=>(
          <div key={i} style={{display:"flex",gap:12,marginBottom:10}}>
            <div style={{width:20,height:20,borderRadius:"50%",background:"#0369a1",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"white",flexShrink:0,marginTop:1}}>{i+1}</div>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:"#e2e8f0"}}>{step}</div>
              <div style={{fontSize:11,color:"#475569"}}>{detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
