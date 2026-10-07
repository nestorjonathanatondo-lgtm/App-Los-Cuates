import { useEffect, useMemo, useRef, useState } from "react";
import "./index.css";
import logoUrl from "./assets/los_cuates_logo_clean.webp";
import {
  MapPin, Navigation, Copy, Smartphone, MessageCircle, Star,
  Clock, Wallet, Camera, X, Check, Plus, Minus,
  CalendarClock, Award, Package,
} from "lucide-react";

/* ================= Constantes ================= */
const PRECIO = 40;
const PUESTO = { lat: 25.436368, lng: -100.99837 };
const FALLBACK_SALTILLO = { lat: 25.438, lng: -100.991 };
const WA_NUM = "528442252582";
const PASS_SUP = "1a2b3c4d";

const SABORES = [
  { id: "queso", nombre: "Queso cheddar", emoji: "🧀", img: queso3d, desc: "Relleno cremoso de queso cheddar" },
  { id: "verde", nombre: "Verde", emoji: "🌿", img: verde3d, desc: "Pechuga de pollo en tomatillo verde" },
  { id: "rojo", nombre: "Rojo", emoji: "🌶️", img: rojo3d, desc: "Pierna de cerdo en salsa roja" },
] as const;
type SaborId = (typeof SABORES)[number]["id"];

const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  pending: { label: "Pendiente", bg: "#FEF3C7", fg: "#92400E" },
  confirmed: { label: "Confirmado", bg: "#D1FAE5", fg: "#065F46" },
  rescheduled: { label: "Reagendado", bg: "#DBEAFE", fg: "#1E40AF" },
  cancelled: { label: "Cancelado", bg: "#FEE2E2", fg: "#991B1B" },
};

/* ================= Tipos ================= */
type Items = Record<SaborId, number>;
type OrderStatus = "pending" | "confirmed" | "rescheduled" | "cancelled";
interface Order {
  folio: string; nombre: string; telefono: string; fecha: string; hora: string;
  notas: string; items: Items; subtotal: number; envio: number; total: number;
  metodo: string; fulfillment: string; pin: { lat: number; lng: number } | null;
  status: OrderStatus; qrUsed: boolean; createdAt: string;
}
interface Client { id: string; nombre: string; telefono: string; sellos: number; createdAt: string; }
interface Promo { id: string; titulo: string; desc: string; activa: boolean; }
interface StockState { queso: number; verde: number; rojo: number; fecha: string; }
interface HorarioState { abierto: boolean; apertura: string; cierre: string; }
interface PagosState { clabe: string; banco: string; titular: string; }

/* ================= Helpers ================= */
const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => isoDay(new Date());
const tomorrowStr = () => { const d = new Date(); d.setDate(d.getDate() + 1); return isoDay(d); };
const anticipationDays = (fecha: string) => {
  if (!fecha) return 0;
  const a = new Date(fecha + "T12:00:00").getTime();
  const b = new Date(todayStr() + "T12:00:00").getTime();
  return Math.round((a - b) / 86400000);
};
const fmt12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${pad(m)}${ap}`;
};
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const genFolio = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `CUATES-${s}`;
};
function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* noop */ }
}
const waLink = (text: string) => `https://wa.me/${WA_NUM}?text=${encodeURIComponent(text)}`;
async function copyText(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch { return false; }
  }
}
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("script"));
    document.body.appendChild(s);
  });
}
function loadLeaflet(): Promise<any> {
  return (async () => {
    if (!(window as any).L) {
      if (!document.querySelector('link[href*="leaflet.css"]')) {
        const l = document.createElement("link");
        l.rel = "stylesheet";
        l.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(l);
      }
      await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
    }
    return (window as any).L;
  })();
}

/* ================= Mapa ================= */
function Mapa({ pin, onPin }: { pin: { lat: number; lng: number } | null; onPin: (p: { lat: number; lng: number }) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const onPinRef = useRef(onPin);
  onPinRef.current = onPin;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L: any) => {
        if (cancelled || !ref.current || mapRef.current) return;
        try {
          delete (L.Icon.Default.prototype as any)._getIconUrl;
          L.Icon.Default.mergeOptions({
            iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
            iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
            shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
          });
          const map = L.map(ref.current).setView([PUESTO.lat, PUESTO.lng], 15);
          mapRef.current = map;
          L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19, attribution: "© OpenStreetMap",
          }).addTo(map);
          const tamalIcon = L.divIcon({
            className: "lc-divicon",
            html: `<div style="font-size:40px;line-height:44px;text-align:center;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))">🫔</div>`,
            iconSize: [44, 44], iconAnchor: [22, 22],
          });
          L.marker([PUESTO.lat, PUESTO.lng], { icon: tamalIcon })
            .addTo(map).bindPopup("<b>Los Cuates</b><br>Puesto de tamales");
          map.on("click", (e: any) => onPinRef.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
          setTimeout(() => { try { map.invalidateSize(); } catch { /* noop */ } }, 500);
        } catch { setFailed(true); }
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (mapRef.current) { try { mapRef.current.remove(); } catch { /* noop */ } mapRef.current = null; }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const L = (window as any).L;
    if (!map || !L) return;
    if (markerRef.current) { try { markerRef.current.remove(); } catch { /* noop */ } markerRef.current = null; }
    if (pin) {
      const pinIcon = L.divIcon({
        className: "lc-divicon",
        html: `<div style="font-size:32px;line-height:36px;text-align:center;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))">📍</div>`,
        iconSize: [36, 36], iconAnchor: [18, 34],
      });
      markerRef.current = L.marker([pin.lat, pin.lng], { icon: pinIcon }).addTo(map).bindPopup("Tu ubicación");
      try { map.setView([pin.lat, pin.lng], Math.max(map.getZoom(), 15)); } catch { /* noop */ }
    }
  }, [pin]);

  if (failed) {
    return (
      <div className="leaflet-map flex items-center justify-center bg-[#F4EFDF] text-center px-6">
        <p className="text-sm text-[#1E2F5E] font-semibold">
          No se pudo cargar el mapa. Toca "Ver ruta" para abrir Google Maps.
        </p>
      </div>
    );
  }
  return <div ref={ref} className="leaflet-map" aria-label="Mapa del puesto" />;
}

/* ================= Cámara QR (supervisión) ================= */
function QrCamera({ onScan }: { onScan: (code: string) => void }) {
  const boxId = useRef(`qrbox-${Math.random().toString(36).slice(2, 8)}`);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const [err, setErr] = useState("");

  useEffect(() => {
    let q: any = null;
    let cancelled = false;
    (async () => {
      try {
        await loadScript("https://unpkg.com/html5-qrcode@2.3.8/minified/html5-qrcode.min.js");
        if (cancelled) return;
        const H = (window as any).Html5Qrcode;
        if (!H) throw new Error("lib");
        q = new H(boxId.current);
        await q.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 220 },
          (txt: string) => { onScanRef.current(txt); try { q.stop(); } catch { /* noop */ } },
          () => { /* frame sin lectura */ }
        );
      } catch { if (!cancelled) setErr("No se pudo abrir la cámara en este dispositivo."); }
    })();
    return () => {
      cancelled = true;
      if (q) { try { q.stop(); } catch { /* noop */ } }
    };
  }, []);

  if (err) return <p className="text-sm text-red-700 font-semibold">{err}</p>;
  return <div id={boxId.current} className="w-full rounded-2xl overflow-hidden bg-black" />;
}

/* ================= App ================= */
export default function App() {
  /* Splash */
  const [splash, setSplash] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setSplash(false), 2800);
    return () => clearTimeout(t);
  }, []);

  /* Fuentes */
  useEffect(() => {
    if (document.querySelector('link[href*="fonts.googleapis.com"]')) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href =
      "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap";
    document.head.appendChild(l);
  }, []);

  /* Persistencia local */
  const [orders, setOrders] = useState<Order[]>(() => load<Order[]>("loscuates_orders", []));
  const [clients, setClients] = useState<Client[]>(() => load<Client[]>("loscuates_clients", []));
  const [promos, setPromos] = useState<Promo[]>(() => load<Promo[]>("loscuates_promos", []));
  const [stock, setStock] = useState<StockState>(() => {
    const s = load<StockState>("loscuates_stock", { queso: 30, verde: 30, rojo: 30, fecha: todayStr() });
    return s.fecha === todayStr() ? s : { queso: 30, verde: 30, rojo: 30, fecha: todayStr() };
  });
  const [stockInicial, setStockInicial] = useState<StockState>(() =>
    load<StockState>("loscuates_stock_inicial", { queso: 30, verde: 30, rojo: 30, fecha: todayStr() })
  );
  const [vendidos, setVendidos] = useState<StockState>(() => {
    const v = load<StockState>("loscuates_vendidos", { queso: 0, verde: 0, rojo: 0, fecha: todayStr() });
    return v.fecha === todayStr() ? v : { queso: 0, verde: 0, rojo: 0, fecha: todayStr() };
  });
  const [horario, setHorario] = useState<HorarioState>(() =>
    load<HorarioState>("loscuates_horario", { abierto: true, apertura: "08:00", cierre: "14:00" })
  );
  const [pagos, setPagos] = useState<PagosState>(() =>
    load<PagosState>("loscuates_pagos", { clabe: "012345678901234567", banco: "BBVA", titular: "Los Cuates" })
  );

  useEffect(() => save("loscuates_orders", orders), [orders]);
  useEffect(() => save("loscuates_clients", clients), [clients]);
  useEffect(() => save("loscuates_promos", promos), [promos]);
  useEffect(() => save("loscuates_stock", stock), [stock]);
  useEffect(() => save("loscuates_stock_inicial", stockInicial), [stockInicial]);
  useEffect(() => save("loscuates_vendidos", vendidos), [vendidos]);
  useEffect(() => save("loscuates_horario", horario), [horario]);
  useEffect(() => save("loscuates_pagos", pagos), [pagos]);

  /* Pedido en curso */
  const [qty, setQty] = useState<Items>({ queso: 0, verde: 0, rojo: 0 });
  const [fulfillment, setFulfillment] = useState<"puesto" | "domicilio">("puesto");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [geoMsg, setGeoMsg] = useState("");
  const [form, setForm] = useState({ nombre: "", telefono: "", fecha: "", hora: "", notas: "" });
  const [metodo, setMetodo] = useState<"efectivo" | "transferencia">("efectivo");
  const [formErr, setFormErr] = useState("");
  const [lastFolio, setLastFolio] = useState("");
  const [copyMsg, setCopyMsg] = useState("");

  /* Supervisión */
  const [supOpen, setSupOpen] = useState(false);
  const [supAuth, setSupAuth] = useState(false);
  const [supPass, setSupPass] = useState("");
  const [supTab, setSupTab] = useState("pedidos");
  const [scanInput, setScanInput] = useState("");
  const [scanMsg, setScanMsg] = useState("");
  const [reagendarFolio, setReagendarFolio] = useState("");
  const [reFecha, setReFecha] = useState("");
  const [reHora, setReHora] = useState("");
  const [promoForm, setPromoForm] = useState({ titulo: "", desc: "" });
  const [stockForm, setStockForm] = useState({ queso: "30", verde: "30", rojo: "30" });
  const [horarioForm, setHorarioForm] = useState({ abierto: true, apertura: "08:00", cierre: "14:00" });
  const [pagosForm, setPagosForm] = useState({ clabe: "", banco: "", titular: "" });
  const [anuncioFormato, setAnuncioFormato] = useState("whatsapp");
  const [anuncioConfig, setAnuncioConfig] = useState({ champurrado: true, horario: true, mapa: true, menu3d: true, textoDestacado: "¡HOY TENEMOS CHAMPURRADO!" });

  useEffect(() => {
    if (supOpen && supAuth) {
      setHorarioForm({ ...horario });
      setPagosForm({ ...pagos });
      setStockForm({ queso: String(stockInicial.queso), verde: String(stockInicial.verde), rojo: String(stockInicial.rojo) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supOpen, supAuth]);

  /* Instalar app */
  const [deferred, setDeferred] = useState<any>(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  useEffect(() => {
    const h = (e: any) => { e.preventDefault(); setDeferred(e); };
    window.addEventListener("beforeinstallprompt", h as any);
    return () => window.removeEventListener("beforeinstallprompt", h as any);
  }, []);

  /* QR compartir */
  const [qrUrl, setQrUrl] = useState("");
  const [qrOk, setQrOk] = useState(true);
  useEffect(() => {
    try {
      const data = encodeURIComponent(window.location.href);
      setQrUrl(`https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${data}`);
    } catch { setQrOk(false); }
  }, []);

  /* Cálculos */
  const totalTamales = qty.queso + qty.verde + qty.rojo;
  const subtotal = totalTamales * PRECIO;
  const km = useMemo(() => (pin ? haversineKm(PUESTO, pin) : 0), [pin]);
  const daysAnt = form.fecha ? anticipationDays(form.fecha) : 0;
  const envioGratis = fulfillment === "domicilio" && totalTamales >= 20 && daysAnt >= 3 && !!form.fecha;
  const envio = fulfillment === "domicilio"
    ? pin ? (envioGratis ? 0 : Math.max(30, Math.round(30 * km))) : 0
    : 0;
  const total = subtotal + envio;
  const stockTotal = stock.queso + stock.verde + stock.rojo;
  const promosActivas = promos.filter((p) => p.activa);

  const setQ = (id: SaborId, delta: number) =>
    setQty((q) => {
      const next = Math.max(0, Math.min(stock[id], q[id] + delta));
      return { ...q, [id]: next };
    });

  const fijarUbicacion = () => {
    setGeoMsg("Buscando tu ubicación…");
    if (!navigator.geolocation) {
      setPin({ ...FALLBACK_SALTILLO });
      setGeoMsg("Sin GPS: usamos un punto de referencia en Saltillo. Toca el mapa para ajustar.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoMsg("Ubicación fijada. Puedes mover el pin tocando el mapa.");
      },
      () => {
        setPin({ ...FALLBACK_SALTILLO });
        setGeoMsg("No se pudo obtener tu ubicación: usamos Saltillo como referencia. Toca el mapa para ajustar tu pin.");
      },
      { timeout: 8000 }
    );
  };

  const crearPedido = () => {
    setFormErr("");
    if (totalTamales === 0) return setFormErr("Agrega al menos 1 tamal a tu pedido.");
    if (!form.nombre.trim()) return setFormErr("Escribe tu nombre.");
    if (!form.fecha) return setFormErr("Elige la fecha de entrega.");
    if (!form.hora) return setFormErr("Elige la hora de entrega.");
    if (totalTamales >= 20 && daysAnt < 3)
      return setFormErr("Los pedidos de 20 o más tamales requieren 3 días de anticipación.");
    if (fulfillment === "domicilio" && !pin)
      return setFormErr("Fija tu pin en el mapa para el envío a domicilio.");
    if (qty.queso > stock.queso || qty.verde > stock.verde || qty.rojo > stock.rojo)
      return setFormErr("No hay suficiente stock de algún sabor.");

    const folio = genFolio();
    const itemsTxt = SABORES.filter((s) => qty[s.id] > 0)
      .map((s) => `• ${qty[s.id]}x ${s.nombre}`)
      .join("\n");
    const entregaTxt =
      fulfillment === "puesto"
        ? "Recoger en puesto"
        : `A domicilio (pin: ${pin!.lat.toFixed(5)}, ${pin!.lng.toFixed(5)} · ${km.toFixed(1)} km)`;
    const msg =
      `Hola Los Cuates, quiero apartar tamales:\n${itemsTxt}\n\n` +
      `Fecha: ${form.fecha} · Hora: ${form.hora}\n` +
      `Nombre: ${form.nombre}${form.telefono ? ` · Tel: ${form.telefono}` : ""}\n` +
      (form.notas ? `Notas: ${form.notas}\n` : "") +
      `Entrega: ${entregaTxt}\n` +
      `Subtotal: $${subtotal} · Envío: ${envioGratis ? "GRATIS" : `$${envio}`} · Total: $${total}\n` +
      `Pago: ${metodo === "efectivo" ? "Efectivo" : "Transferencia"}\n` +
      `Folio: ${folio}`;

    const order: Order = {
      folio, nombre: form.nombre.trim(), telefono: form.telefono.trim(),
      fecha: form.fecha, hora: form.hora, notas: form.notas.trim(),
      items: { ...qty }, subtotal, envio, total,
      metodo: metodo === "efectivo" ? "Efectivo" : "Transferencia",
      fulfillment: fulfillment === "puesto" ? "Recoger en puesto" : "A domicilio",
      pin: pin ? { ...pin } : null, status: "pending", qrUsed: false,
      createdAt: new Date().toISOString(),
    };
    setOrders((o) => [order, ...o]);
    setStock((s) => ({ ...s, queso: s.queso - qty.queso, verde: s.verde - qty.verde, rojo: s.rojo - qty.rojo }));
    setVendidos((v) => ({ ...v, queso: v.queso + qty.queso, verde: v.verde + qty.verde, rojo: v.rojo + qty.rojo }));
    setClients((cs) => {
      const tel = form.telefono.trim();
      const found = cs.find((c) => tel && c.telefono === tel);
      if (found) return cs;
      return [...cs, { id: `c-${Date.now()}`, nombre: form.nombre.trim(), telefono: tel, sellos: 0, createdAt: new Date().toISOString() }];
    });

    setQty({ queso: 0, verde: 0, rojo: 0 });
    setLastFolio(folio);
    window.open(waLink(msg), "_blank");
  };

  /* Supervisión: acciones */
  const setOrderStatus = (folio: string, status: OrderStatus, fecha?: string, hora?: string) =>
    setOrders((os) => os.map((o) => (o.folio === folio ? { ...o, status, ...(fecha ? { fecha } : {}), ...(hora ? { hora } : {}) } : o)));

  const handleScan = (codeRaw: string) => {
    const code = codeRaw.trim().toUpperCase();
    if (!code) return setScanMsg("Escribe o escanea un folio.");
    const order = orders.find((o) => o.folio === code);
    if (!order) return setScanMsg(`No encontramos el folio ${code}.`);
    if (order.qrUsed) return setScanMsg(`El folio ${code} ya fue registrado antes.`);
    const n = order.items.queso + order.items.verde + order.items.rojo;
    setOrders((os) => os.map((o) => (o.folio === code ? { ...o, qrUsed: true, status: "confirmed" } : o)));
    let sellosTot = 0;
    setClients((cs) => {
      const i = cs.findIndex((c) => order.telefono && c.telefono === order.telefono);
      if (i >= 0) {
        const nc = [...cs];
        nc[i] = { ...nc[i], sellos: nc[i].sellos + n };
        sellosTot = nc[i].sellos;
        return nc;
      }
      const nuevo: Client = { id: `c-${Date.now()}`, nombre: order.nombre, telefono: order.telefono, sellos: n, createdAt: new Date().toISOString() };
      sellosTot = n;
      return [...cs, nuevo];
    });
    setTimeout(() => {
      setScanMsg(
        sellosTot >= 10
          ? `Folio ${code} validado. +${n} sellos. Total: ${sellosTot}. PREMIO DISPONIBLE: canjea 10 sellos por tamales gratis.`
          : `Folio ${code} validado. +${n} sellos. Total: ${sellosTot}. Faltan ${10 - sellosTot} sellos para el premio.`
      );
    }, 0);
    setScanInput("");
  };

  const guardarStock = () => {
    const ini: StockState = {
      queso: Math.max(0, parseInt(stockForm.queso) || 0),
      verde: Math.max(0, parseInt(stockForm.verde) || 0),
      rojo: Math.max(0, parseInt(stockForm.rojo) || 0),
      fecha: todayStr(),
    };
    setStockInicial(ini);
    setStock(ini);
    setVendidos({ queso: 0, verde: 0, rojo: 0, fecha: todayStr() });
    setScanMsg("Stock del día guardado.");
  };
  const resetDia = () => {
    setStock({ ...stockInicial, fecha: todayStr() });
    setVendidos({ queso: 0, verde: 0, rojo: 0, fecha: todayStr() });
    setScanMsg("Día reiniciado con el stock inicial.");
  };

  const addPromo = () => {
    if (!promoForm.titulo.trim()) return;
    setPromos((p) => [...p, { id: `p-${Date.now()}`, titulo: promoForm.titulo.trim(), desc: promoForm.desc.trim(), activa: true }]);
    setPromoForm({ titulo: "", desc: "" });
  };

  const misSellos = (() => {
    const tel = form.telefono.trim();
    if (!tel) return null;
    const c = clients.find((x) => x.telefono === tel);
    return c ? c.sellos : null;
  })();

  /* ================= Render ================= */
  if (splash) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-between py-14 px-8">
        <img src={logoUrl} alt="Los Cuates" className="w-40 h-40 rounded-full object-cover" />
        <div className="w-56 h-2 rounded-full shimmer-bar" />
        <img src={jmUrl} alt="JM Design" className="w-28 h-28 rounded-full object-cover" />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen"
      style={{ paddingTop: "var(--safe-area-inset-top)", boxSizing: "border-box" }}
    >
      <div className="max-w-2xl mx-auto px-4 pb-24">

        {/* ============ HEADER ============ */}
        <header className="pt-8 pb-4 text-center">
          <img
            src={logoUrl}
            alt="Los Cuates — Tamales"
            className="w-[210px] h-[210px] rounded-full object-cover mx-auto"
            style={{ filter: "drop-shadow(0 10px 24px rgba(30,47,94,.18))" }}
          />
          <h1 className="font-display text-5xl mt-4 text-[#1E2F5E] leading-none">Los Cuates</h1>
          <p className="text-sm tracking-[0.25em] uppercase text-[#B9975B] font-bold mt-2">Tamales · Saltillo</p>

          <div className="mt-5 space-y-2">
            {promosActivas.map((p) => (
              <div key={p.id} className="banner" style={{ background: "#1E2F5E", color: "#F5E6BD" }}>
                <span className="font-display text-base">{p.titulo}</span>
                {p.desc ? <span className="block text-xs font-normal opacity-90">{p.desc}</span> : null}
              </div>
            ))}
            <div
              className="banner"
              style={horario.abierto ? { background: "#E7F6E7", color: "#166534" } : { background: "#FDE8E8", color: "#991B1B" }}
            >
              {horario.abierto ? `🟢 Abierto ahora • Cerramos ${fmt12(horario.cierre)}` : "🔴 Cerrado ahora • Apartando para mañana"}
            </div>
            <div
              className="banner"
              style={stockTotal > 0 ? { background: "#E7F6E7", color: "#166534" } : { background: "#FDE8E8", color: "#991B1B" }}
            >
              {stockTotal > 0 ? `🟢 Hoy tenemos ${stockTotal} tamales` : "🔴 Por hoy se acabó, aparta para mañana"}
            </div>
          </div>
        </header>

        {/* ============ MENÚ ============ */}
        <section id="menu" className="mt-4">
          <h2 className="font-display text-3xl text-[#1E2F5E] mb-1">Menú</h2>
          <p className="text-sm text-gray-500 mb-4">$40 c/u · hechos con amor cada mañana</p>
          <div className="space-y-4">
            {SABORES.map((s) => (
              <div key={s.id} className="card p-5 flex items-center gap-4">
                <img src={(s as any).img || ""} alt={s.nombre} className="w-16 h-16 object-contain drop-shadow-lg" style={{ filter: "drop-shadow(0 4px 8px rgba(0,0,0,.15))" }} />
                <div className="flex-1 min-w-0">
                  <h3 className="font-display text-2xl text-[#1E2F5E] leading-tight">{s.nombre}</h3>
                  <p className="text-xs text-gray-500">{s.desc}</p>
                  <p className="text-xs font-bold mt-1" style={{ color: stock[s.id] > 0 ? "#166534" : "#991B1B" }}>
                    {stock[s.id] > 0 ? `Quedan ${stock[s.id]}` : "Agotado por hoy"}
                  </p>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <div className="flex items-center gap-3">
                    <button className="qty-btn" onClick={() => setQ(s.id, -1)} disabled={qty[s.id] === 0} aria-label={`Quitar ${s.nombre}`}>−</button>
                    <span className="font-extrabold text-xl text-[#1E2F5E] w-8 text-center">{qty[s.id]}</span>
                    <button
                      className="qty-btn"
                      onClick={() => setQ(s.id, 1)}
                      disabled={qty[s.id] >= stock[s.id] || stock[s.id] === 0}
                      aria-label={`Agregar ${s.nombre}`}
                    >+</button>
                  </div>
                  <span className="text-sm font-bold text-[#B9975B]">${PRECIO * qty[s.id]}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="card mt-4 p-5 flex items-center justify-between">
            <span className="font-bold text-[#1E2F5E]">Subtotal ({totalTamales} tamales)</span>
            <span className="font-display text-3xl text-[#1E2F5E]">${subtotal}</span>
          </div>
        </section>

        {/* ============ ENTREGA / MAPA ============ */}
        <section id="entrega" className="mt-10">
          <h2 className="font-display text-3xl text-[#1E2F5E] mb-4">Entrega</h2>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <label className={`radio-neu ${fulfillment === "puesto" ? "active" : ""}`}>
              <input type="radio" className="sr-only" checked={fulfillment === "puesto"} onChange={() => setFulfillment("puesto")} />
              <span className="radio-dot" />
              Recoger en puesto
            </label>
            <label className={`radio-neu ${fulfillment === "domicilio" ? "active" : ""}`}>
              <input type="radio" className="sr-only" checked={fulfillment === "domicilio"} onChange={() => setFulfillment("domicilio")} />
              <span className="radio-dot" />
              A domicilio
            </label>
          </div>

          <div className="card p-3">
            <Mapa pin={pin} onPin={setPin} />
            <div className="flex flex-wrap gap-3 p-3">
              <button className="btn-outline flex items-center gap-2 !py-3 !px-4 text-sm" onClick={fijarUbicacion}>
                <MapPin size={16} /> Fijar mi ubicación
              </button>
              <a
                className="btn-outline flex items-center gap-2 !py-3 !px-4 text-sm no-underline"
                href={`https://www.google.com/maps/dir/?api=1&destination=${PUESTO.lat},${PUESTO.lng}`}
                target="_blank" rel="noopener"
              >
                <Navigation size={16} /> Ver ruta
              </a>
            </div>
            {geoMsg ? <p className="px-4 pb-3 text-xs text-gray-600">{geoMsg}</p> : null}
            <p className="px-4 pb-4 text-xs text-gray-500">
              Toca el mapa para fijar tu pin de entrega. Envío: $30 por km (mínimo $30). Gratis en pedidos de 20+ tamales con 3 días de anticipación.
            </p>
          </div>

          {fulfillment === "domicilio" && (
            <div className="card mt-4 p-5">
              {pin ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-[#1E2F5E]">Distancia aprox: {km.toFixed(1)} km</span>
                  <span className="font-display text-2xl text-[#1E2F5E]">
                    {envioGratis ? "GRATIS" : `$${envio}`}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-gray-600">Fija tu pin en el mapa para calcular el envío.</p>
              )}
              {envioGratis && <p className="text-xs font-bold text-green-700 mt-2">Envío gratis por 20+ tamales con 3 días de anticipación.</p>}
            </div>
          )}
        </section>

        {/* ============ APARTAR ============ */}
        <section id="apartar" className="mt-10">
          <h2 className="font-display text-3xl text-[#1E2F5E] mb-4">Aparta tu pedido</h2>
          <div className="card p-5 space-y-4">
            <div>
              <label className="lbl" htmlFor="f-nombre">Nombre</label>
              <input id="f-nombre" className="field" placeholder="Tu nombre" value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            </div>
            <div>
              <label className="lbl" htmlFor="f-tel">Teléfono / WhatsApp</label>
              <input id="f-tel" className="field" inputMode="tel" placeholder="844 123 4567" value={form.telefono}
                onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="lbl" htmlFor="f-fecha">Fecha</label>
                <input id="f-fecha" type="date" className="field" min={tomorrowStr()} value={form.fecha}
                  onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
              </div>
              <div>
                <label className="lbl" htmlFor="f-hora">Hora</label>
                <input id="f-hora" type="time" className="field" value={form.hora}
                  onChange={(e) => setForm({ ...form, hora: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="lbl" htmlFor="f-notas">Notas</label>
              <textarea id="f-notas" className="field" rows={2} placeholder="¿Algo que debamos saber?"
                value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
            </div>
            {lastFolio && (
              <div className="rounded-2xl p-4 text-center" style={{ background: "#E7F6E7" }}>
                <p className="text-sm font-bold text-green-800">¡Pedido registrado! Tu folio es</p>
                <p className="font-display text-3xl text-green-900">{lastFolio}</p>
                <p className="text-xs text-green-700 mt-1">Te abrimos WhatsApp para confirmarlo.</p>
              </div>
            )}
          </div>
        </section>

        {/* ============ PAGO ============ */}
        <section id="pago" className="mt-10">
          <h2 className="font-display text-3xl text-[#1E2F5E] mb-4">💳 Cómo pagas?</h2>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <label className={`radio-neu ${metodo === "efectivo" ? "active" : ""}`}>
              <input type="radio" className="sr-only" checked={metodo === "efectivo"} onChange={() => setMetodo("efectivo")} />
              <span className="radio-dot" /> Efectivo
            </label>
            <label className={`radio-neu ${metodo === "transferencia" ? "active" : ""}`}>
              <input type="radio" className="sr-only" checked={metodo === "transferencia"} onChange={() => setMetodo("transferencia")} />
              <span className="radio-dot" /> Transferencia
            </label>
          </div>
          {metodo === "transferencia" && (
            <div className="card p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-[#B9975B] mb-3">Datos para transferir</p>
              <div className="space-y-2 text-sm">
                <p><span className="font-bold text-[#1E2F5E]">Titular:</span> {pagos.titular}</p>
                <p><span className="font-bold text-[#1E2F5E]">Banco:</span> {pagos.banco}</p>
                <p className="flex items-center justify-between gap-2 flex-wrap">
                  <span><span className="font-bold text-[#1E2F5E]">CLABE:</span> <span className="font-mono">{pagos.clabe}</span></span>
                  <button
                    className="btn-outline !py-2 !px-3 text-xs flex items-center gap-1"
                    onClick={async () => {
                      const ok = await copyText(pagos.clabe);
                      setCopyMsg(ok ? "CLABE copiada" : "No se pudo copiar, anótala manualmente");
                      setTimeout(() => setCopyMsg(""), 2500);
                    }}
                  >
                    <Copy size={14} /> Copiar CLABE
                  </button>
                </p>
                {copyMsg && <p className="text-xs font-bold text-green-700">{copyMsg}</p>}
              </div>
            </div>
          )}
        </section>

        {/* ============ RESUMEN + CTA ============ */}
        <section className="mt-8">
          <div className="card p-5 space-y-2">
            <div className="flex justify-between text-sm"><span>Subtotal</span><span className="font-bold">${subtotal}</span></div>
            <div className="flex justify-between text-sm">
              <span>Envío {fulfillment === "puesto" ? "(en puesto)" : ""}</span>
              <span className="font-bold">{envioGratis ? "GRATIS" : `$${envio}`}</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-[#E9E0C9]">
              <span className="font-bold text-[#1E2F5E]">Total</span>
              <span className="font-display text-4xl text-[#1E2F5E]">${total}</span>
            </div>
          </div>
          {formErr && <p className="mt-3 text-sm font-bold text-red-700 text-center">{formErr}</p>}
          <button className="btn-primary w-full mt-4 text-lg" onClick={crearPedido}>
            {horario.abierto ? "Pedir por WhatsApp 🫔" : "Apartar para mañana"}
          </button>
          <p className="text-xs text-gray-500 text-center mt-2">
            Se abrirá WhatsApp con tu pedido listo para enviar. Guarda tu folio para recoger.
          </p>
        </section>

        {/* ============ MIS PEDIDOS ============ */}
        <section id="pedidos" className="mt-10">
          <h2 className="font-display text-3xl text-[#1E2F5E] mb-4">Mis pedidos</h2>
          {orders.length === 0 ? (
            <div className="card p-6 text-center text-sm text-gray-500">
              Aún no tienes pedidos en este dispositivo. ¡Arma el tuyo arriba!
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map((o) => {
                const meta = STATUS_META[o.status] || STATUS_META.pending;
                const itemsTxt = SABORES.filter((s) => o.items[s.id] > 0).map((s) => `${o.items[s.id]}x ${s.nombre}`).join(", ");
                return (
                  <div key={o.folio} className="card p-4">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-mono font-bold text-[#1E2F5E]">{o.folio}</span>
                      <span className="badge" style={{ background: meta.bg, color: meta.fg }}>{meta.label}</span>
                      </div>
                      <p className="text-sm mt-2">{itemsTxt}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {o.fecha} · {o.hora} · {o.fulfillment} · {o.metodo} · Total ${o.total}
                    </p>
                    {o.qrUsed && <p className="text-xs font-bold text-green-700 mt-1">QR registrado en puesto</p>}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ============ APP / QR ============ */}
        <section id="app" className="mt-10">
          <h2 className="font-display text-3xl text-[#1E2F5E] mb-4">Lleva Los Cuates contigo</h2>
          <div className="card p-6 text-center">
            <button
              className="btn-primary w-full flex items-center justify-center gap-2"
              onClick={() => {
                if (deferred) { deferred.prompt(); setDeferred(null); }
                else setShowInstallHelp((v) => !v);
              }}
            >
              <Smartphone size={18} /> PREMIUM • INSTALAR APP
            </button>
            {showInstallHelp && (
              <div className="mt-4 text-left text-sm bg-[#FFFCF2] rounded-2xl p-4 border border-[#E9E0C9]">
                <p className="font-bold text-[#1E2F5E] mb-2">Cómo instalar:</p>
                <p><b>iPhone:</b> Compartir → Añadir a inicio</p>
                <p><b>Android:</b> Menú → Instalar app</p>
              </div>
            )}
            <div className="mt-6">
              <p className="lbl !mb-2">QR para compartir</p>
              {qrOk && qrUrl ? (
                <img
                  src={qrUrl} alt="QR para compartir Los Cuates"
                  className="w-44 h-44 mx-auto rounded-2xl border border-[#E9E0C9]"
                  onError={() => setQrOk(false)}
                />
              ) : (
                <p className="text-xs text-gray-500">Comparte este enlace: {typeof window !== "undefined" ? window.location.href : ""}</p>
              )}
            </div>
          </div>

          <div className="card p-6 mt-4 text-center" style={{ background: "#1E2F5E", border: "none" }}>
            <Award className="mx-auto text-[#B9975B]" size={32} />
            <p className="font-display text-2xl text-white mt-2">Lealtad Los Cuates</p>
            <p className="text-sm text-[#F5E6BD] mt-2">En la compra de 6 tamales, el 7 es gratis utilizando la app.</p>
            {misSellos !== null && (
              <p className="mt-3 inline-block badge" style={{ background: "#B9975B", color: "#1E2F5E" }}>
                Llevas {misSellos} sellos · premio a los 10
              </p>
            )}
          </div>

          <div className="card p-5 mt-4">
            <label className="lbl" htmlFor="f-sabor">¿Qué sabores te gustaría agregar?</label>
            <div className="flex gap-2">
              <input id="f-sabor" className="field" placeholder="Ej. rajas con crema" />
              <button
                className="btn-outline !py-3 whitespace-nowrap text-sm"
                onClick={(e) => {
                  const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
                  const v = input.value.trim();
                  if (!v) return;
                  window.open(waLink(`Hola Los Cuates, me gustaría que agregaran este sabor: ${v}`), "_blank");
                  input.value = "";
                }}
              >Enviar</button>
            </div>
          </div>

          <div className="card p-5 mt-4">
            <label className="lbl" htmlFor="f-queja">Quejas y sugerencias</label>
            <textarea id="f-queja" className="field" rows={3} placeholder="Cuéntanos cómo mejorar…" />
            <button
              className="btn-primary w-full mt-3 flex items-center justify-center gap-2"
              onClick={(e) => {
                const ta = (e.currentTarget.previousElementSibling as HTMLTextAreaElement);
                const v = ta.value.trim();
                if (!v) return;
                window.open(waLink(`Queja / sugerencia Los Cuates:\n${v}`), "_blank");
                ta.value = "";
              }}
            >
              <MessageCircle size={18} /> Enviar por WhatsApp
            </button>
          </div>

          <div className="card p-5 mt-4 text-center">
            <div className="flex justify-center gap-1 text-[#B9975B] mb-2" aria-hidden>
              <Star size={18} fill="currentColor" /><Star size={18} fill="currentColor" /><Star size={18} fill="currentColor" /><Star size={18} fill="currentColor" /><Star size={18} fill="currentColor" />
            </div>
            <p className="text-sm font-semibold text-[#1E2F5E]">Deja tu reseña en Google Maps y muestra la captura</p>
            <p className="font-display text-2xl text-[#B9975B] mt-1">20% de descuento</p>
            <a
              className="btn-outline inline-flex items-center gap-2 mt-3 no-underline text-sm"
              href="https://www.google.com/maps/search/?api=1&query=tamales+Los+Cuates+Saltillo"
              target="_blank" rel="noopener"
            >
              <Star size={16} /> Dejar reseña
            </a>
          </div>
        </section>

        {/* ============ POLÍTICAS ============ */}
        <section className="mt-10 politicas">
          <h2 className="font-display text-2xl text-[#1E2F5E] mb-3">Políticas — Saltillo</h2>
          <p><strong>Fuera de horario +10:</strong> después de las 12:00pm se pide 50% de anticipo. Pedidos con 1 día de anticipación: mínimo 10 tamales. Pedidos de 20 o más tamales: 3 días de anticipación y envío gratis.</p>
          <p><strong>Eventos:</strong> fiestas y posadas se agendan con 3–4 días de anticipación y 50% de anticipo. Cancelaciones hasta 2 días antes sin penalización.</p>
          <p><strong>Envío $30 x km:</strong> calculado con distancia Haversine del puesto a tu pin, mínimo $30, se suma al total. Recoger en puesto no tiene costo.</p>
        </section>

        {/* ============ FOOTER ============ */}
        <footer className="mt-10 text-center pb-8">
          <p className="font-display text-4xl text-[#1E2F5E]">JM Design</p>
          <p className="text-xs text-gray-500 mt-3 leading-relaxed">
            Instala: iPhone → Compartir → Añadir a inicio · Android → Menú → Instalar app
          </p>
          <p className="text-xs text-gray-500 mt-1">WhatsApp 844-225-2582 · Hecho con 🫔 en Saltillo</p>
        </footer>
      </div>

      {/* ============ BOTÓN SUPERVISIÓN OCULTO ============ */}
      <button
        aria-label="Supervisión"
        onClick={() => { setSupOpen(true); setSupAuth(false); setSupPass(""); setSupTab("pedidos"); setScanMsg(""); }}
        style={{ position: "fixed", bottom: 12, right: 12, width: 18, height: 18, opacity: 0.05, background: "#1E2F5E", border: "none", borderRadius: 4, cursor: "pointer", zIndex: 50 }}
      />

      {/* ============ MODAL SUPERVISIÓN ============ */}
      {supOpen && (
        <div className="fixed inset-0 z-[70] bg-[#FFFCF2] overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-6 pb-16">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-3xl text-[#1E2F5E]">Supervisión</h2>
              <button className="qty-btn" onClick={() => setSupOpen(false)} aria-label="Cerrar"><X size={18} /></button>
            </div>

            {!supAuth ? (
              <div className="card p-6 max-w-sm mx-auto mt-10">
                <label className="lbl" htmlFor="sup-pass">Contraseña</label>
                <input
                  id="sup-pass" type="password" className="field" value={supPass}
                  onChange={(e) => setSupPass(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") setSupAuth(supPass === PASS_SUP); }}
                />
                <button className="btn-primary w-full mt-4" onClick={() => setSupAuth(supPass === PASS_SUP)}>Entrar</button>
              </div>
            ) : (
              <>
                <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
                  {[
                    ["pedidos", "Pedidos"], ["clientes", "Clientes DB"], ["qr", "Lector QR"],
                    ["promos", "Promos"], ["lealtad", "Lealtad"], ["stock", "Stock"],
                    ["pagos", "Pagos"], ["horario", "Horario"], ["anuncios", "Anuncios 📣"],
                  ].map(([id, label]) => (
                    <button key={id} className={`sup-tab ${supTab === id ? "active" : ""}`} onClick={() => { setSupTab(id); setScanMsg(""); }}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* PEDIDOS */}
                {supTab === "pedidos" && (
                  <div className="space-y-3">
                    {orders.length === 0 && <div className="card p-6 text-center text-sm text-gray-500">Sin pedidos registrados.</div>}
                    {orders.map((o) => {
                      const meta = STATUS_META[o.status] || STATUS_META.pending;
                      const itemsTxt = SABORES.filter((s) => o.items[s.id] > 0).map((s) => `${o.items[s.id]}x ${s.nombre}`).join(", ");
                      return (
                        <div key={o.folio} className="card p-4">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="font-mono font-bold text-[#1E2F5E]">{o.folio}</span>
                            <span className="badge" style={{ background: meta.bg, color: meta.fg }}>{meta.label}</span>
                          </div>
                          <p className="text-sm mt-1 font-semibold">{o.nombre}{o.telefono ? ` · ${o.telefono}` : ""}</p>
                          <p className="text-sm">{itemsTxt}</p>
                          <p className="text-xs text-gray-500">{o.fecha} · {o.hora} · {o.fulfillment} · {o.metodo} · Total ${o.total}{o.notas ? ` · ${o.notas}` : ""}</p>
                          <div className="flex flex-wrap gap-2 mt-3">
                            <button className="btn-outline !py-2 !px-3 text-xs flex items-center gap-1" onClick={() => setOrderStatus(o.folio, "confirmed")}>
                              <Check size={14} /> Confirmar
                            </button>
                            <button className="btn-outline !py-2 !px-3 text-xs flex items-center gap-1" onClick={() => { setReagendarFolio(o.folio); setReFecha(o.fecha); setReHora(o.hora); }}>
                              <CalendarClock size={14} /> Reagendar
                            </button>
                            <button className="btn-outline !py-2 !px-3 text-xs flex items-center gap-1" onClick={() => setOrderStatus(o.folio, "cancelled")}>
                              <X size={14} /> Cancelar
                            </button>
                          </div>
                          {reagendarFolio === o.folio && (
                            <div className="mt-3 flex gap-2 items-end flex-wrap bg-[#FFFCF2] p-3 rounded-2xl border border-[#E9E0C9]">
                              <div><label className="lbl">Nueva fecha</label><input type="date" className="field" min={tomorrowStr()} value={reFecha} onChange={(e) => setReFecha(e.target.value)} /></div>
                              <div><label className="lbl">Nueva hora</label><input type="time" className="field" value={reHora} onChange={(e) => setReHora(e.target.value)} /></div>
                              <button className="btn-primary !py-2 !px-4 text-sm" onClick={() => { if (reFecha && reHora) { setOrderStatus(o.folio, "rescheduled", reFecha, reHora); setReagendarFolio(""); } }}>Guardar</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* CLIENTES */}
                {supTab === "clientes" && (
                  <div className="card p-4">
                    {clients.length === 0 && <p className="text-sm text-gray-500 text-center p-4">Sin clientes registrados.</p>}
                    {clients.map((c) => {
                      const nPed = orders.filter((o) => c.telefono && o.telefono === c.telefono).length;
                      return (
                        <div key={c.id} className="flex items-center justify-between py-3 border-b border-[#EFEAD8] last:border-0 gap-2">
                          <div>
                            <p className="font-bold text-sm text-[#1E2F5E]">{c.nombre || "Sin nombre"}</p>
                            <p className="text-xs text-gray-500">{c.telefono || "—"} · {nPed} pedidos</p>
                          </div>
                          <span className="badge" style={{ background: "#E9E0C9", color: "#1E2F5E" }}>{c.sellos} sellos</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* LECTOR QR */}
                {supTab === "qr" && (
                  <div className="space-y-4">
                    <div className="card p-5">
                      <label className="lbl" htmlFor="qr-manual">Folio manual</label>
                      <div className="flex gap-2">
                        <input id="qr-manual" className="field font-mono uppercase" placeholder="CUATES-XXXX" value={scanInput}
                          onChange={(e) => setScanInput(e.target.value.toUpperCase())}
                          onKeyDown={(e) => { if (e.key === "Enter") handleScan(scanInput); }} />
                        <button className="btn-primary !py-3 whitespace-nowrap text-sm" onClick={() => handleScan(scanInput)}>Validar</button>
                      </div>
                      {scanMsg && <p className="text-sm font-semibold text-[#1E2F5E] mt-3 bg-[#FFFCF2] p-3 rounded-xl border border-[#E9E0C9]">{scanMsg}</p>}
                    </div>
                    <div className="card p-5">
                      <p className="lbl flex items-center gap-2"><Camera size={14} /> Cámara</p>
                      {(window as any).isSecureContext ? (
                        <QrCamera onScan={handleScan} />
                      ) : (
                        <p className="text-sm font-semibold text-amber-800 bg-amber-50 p-4 rounded-xl">
                          Abre en Chrome con https para usar cámara.
                        </p>
                      )}
                      <p className="text-xs text-gray-500 mt-3">Al escanear: se marca qrUsed, se confirman los sellos de lealtad (10 tamales = premio) y se muestra recordatorio al cliente.</p>
                    </div>
                  </div>
                )}

                {/* PROMOS */}
                {supTab === "promos" && (
                  <div className="space-y-4">
                    <div className="card p-5 space-y-3">
                      <div><label className="lbl">Título</label><input className="field" value={promoForm.titulo} onChange={(e) => setPromoForm({ ...promoForm, titulo: e.target.value })} placeholder="Ej. Martes 2x1" /></div>
                      <div><label className="lbl">Descripción</label><input className="field" value={promoForm.desc} onChange={(e) => setPromoForm({ ...promoForm, desc: e.target.value })} placeholder="Detalles de la promo" /></div>
                      <button className="btn-primary w-full" onClick={addPromo}>Crear promo</button>
                    </div>
                    {promos.map((p) => (
                      <div key={p.id} className="card p-4 flex items-center justify-between gap-2">
                        <div>
                          <p className="font-bold text-[#1E2F5E]">{p.titulo}</p>
                          <p className="text-xs text-gray-500">{p.desc}</p>
                        </div>
                        <div className="flex gap-2">
                          <button className="btn-outline !py-2 !px-3 text-xs" onClick={() => setPromos((ps) => ps.map((x) => (x.id === p.id ? { ...x, activa: !x.activa } : x)))}>
                            {p.activa ? "Desactivar" : "Activar"}
                          </button>
                          <button className="btn-outline !py-2 !px-3 text-xs" onClick={() => setPromos((ps) => ps.filter((x) => x.id !== p.id))}>Eliminar</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* LEALTAD */}
                {supTab === "lealtad" && (
                  <div className="card p-4">
                    <p className="text-xs text-gray-500 mb-2">10 sellos = premio. 1 tamal = 1 sello.</p>
                    {clients.length === 0 && <p className="text-sm text-gray-500 text-center p-4">Sin clientes.</p>}
                    {clients.map((c) => (
                      <div key={c.id} className="flex items-center justify-between py-3 border-b border-[#EFEAD8] last:border-0 gap-2 flex-wrap">
                        <div>
                          <p className="font-bold text-sm text-[#1E2F5E]">{c.nombre || "Sin nombre"} {c.telefono ? `· ${c.telefono}` : ""}</p>
                          <p className={`text-xs font-bold ${c.sellos >= 10 ? "text-green-700" : "text-gray-500"}`}>
                            {c.sellos} sellos {c.sellos >= 10 ? "· PREMIO DISPONIBLE" : `· faltan ${10 - c.sellos}`}
                          </p>
                        </div>
                        <div className="flex gap-2 items-center">
                          <button className="qty-btn !w-9 !h-9 !text-lg" onClick={() => setClients((cs) => cs.map((x) => (x.id === c.id ? { ...x, sellos: Math.max(0, x.sellos - 1) } : x)))} aria-label="Quitar sello"><Minus size={14} /></button>
                          <button className="qty-btn !w-9 !h-9 !text-lg" onClick={() => setClients((cs) => cs.map((x) => (x.id === c.id ? { ...x, sellos: x.sellos + 1 } : x)))} aria-label="Agregar sello"><Plus size={14} /></button>
                          <button
                            className="btn-outline !py-2 !px-3 text-xs"
                            disabled={c.sellos < 10}
                            onClick={() => setClients((cs) => cs.map((x) => (x.id === c.id ? { ...x, sellos: x.sellos - 10 } : x)))}
                          >Canjear premio</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* STOCK */}
                {supTab === "stock" && (
                  <div className="space-y-4">
                    <div className="card p-5">
                      <p className="lbl">Stock inicial por sabor</p>
                      <div className="grid grid-cols-3 gap-3">
                        {(["queso", "verde", "rojo"] as SaborId[]).map((id) => (
                          <div key={id}>
                            <label className="lbl capitalize">{id}</label>
                            <input type="number" min={0} className="field" value={(stockForm as any)[id]}
                              onChange={(e) => setStockForm({ ...stockForm, [id]: e.target.value })} />
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-3 mt-4">
                        <button className="btn-primary flex-1" onClick={guardarStock}>Guardar</button>
                        <button className="btn-outline flex-1" onClick={resetDia}>Reset día</button>
                      </div>
                      {scanMsg && <p className="text-sm font-semibold text-green-700 mt-3">{scanMsg}</p>}
                    </div>
                    <div className="card p-5">
                      <p className="lbl flex items-center gap-2"><Package size={14} /> Vendidos hoy</p>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between"><span>Queso cheddar</span><b>{vendidos.queso}</b></div>
                        <div className="flex justify-between"><span>Verde</span><b>{vendidos.verde}</b></div>
                        <div className="flex justify-between"><span>Rojo</span><b>{vendidos.rojo}</b></div>
                        <div className="flex justify-between pt-2 border-t border-[#E9E0C9] font-bold text-[#1E2F5E]">
                          <span>Total</span><span>${(vendidos.queso + vendidos.verde + vendidos.rojo) * PRECIO}</span>
                        </div>
                      </div>
                      <p className="lbl mt-4">Stock actual</p>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between"><span>Queso cheddar</span><b>{stock.queso}</b></div>
                        <div className="flex justify-between"><span>Verde</span><b>{stock.verde}</b></div>
                        <div className="flex justify-between"><span>Rojo</span><b>{stock.rojo}</b></div>
                      </div>
                    </div>
                  </div>
                )}

                {/* PAGOS */}
                {supTab === "pagos" && (
                  <div className="card p-5 space-y-4">
                    <p className="lbl flex items-center gap-2"><Wallet size={14} /> Datos de transferencia</p>
                    <div><label className="lbl">CLABE</label><input className="field font-mono" value={pagosForm.clabe} onChange={(e) => setPagosForm({ ...pagosForm, clabe: e.target.value })} /></div>
                    <div><label className="lbl">Banco</label><input className="field" value={pagosForm.banco} onChange={(e) => setPagosForm({ ...pagosForm, banco: e.target.value })} /></div>
                    <div><label className="lbl">Titular</label><input className="field" value={pagosForm.titular} onChange={(e) => setPagosForm({ ...pagosForm, titular: e.target.value })} /></div>
                    <button className="btn-primary w-full" onClick={() => { setPagos({ ...pagosForm }); setScanMsg("Datos de pago actualizados."); }}>Guardar</button>
                    {scanMsg && <p className="text-sm font-semibold text-green-700">{scanMsg}</p>}
                  </div>
                )}

                {/* HORARIO */}
                {supTab === "horario" && (
                  <div className="card p-5 space-y-4">
                    <p className="lbl flex items-center gap-2"><Clock size={14} /> Estado del puesto</p>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#1E2F5E]">{horarioForm.abierto ? "Abierto" : "Cerrado"}</span>
                      <button
                        className={`switch ${horarioForm.abierto ? "on" : ""}`}
                        onClick={() => setHorarioForm({ ...horarioForm, abierto: !horarioForm.abierto })}
                        aria-label="Cambiar estado abierto/cerrado"
                      ><span className="knob" /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="lbl">Apertura</label><input type="time" className="field" value={horarioForm.apertura} onChange={(e) => setHorarioForm({ ...horarioForm, apertura: e.target.value })} /></div>
                      <div><label className="lbl">Cierre</label><input type="time" className="field" value={horarioForm.cierre} onChange={(e) => setHorarioForm({ ...horarioForm, cierre: e.target.value })} /></div>
                    </div>
                    <button className="btn-primary w-full" onClick={() => { setHorario({ ...horarioForm }); setScanMsg("Horario actualizado."); }}>Guardar</button>
                    {scanMsg && <p className="text-sm font-semibold text-green-700">{scanMsg}</p>}
                    <p className="text-xs text-gray-500">Vista previa: {horarioForm.abierto ? `🟢 Abierto ahora • Cerramos ${fmt12(horarioForm.cierre)}` : "🔴 Cerrado ahora • Apartando para mañana"}</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
