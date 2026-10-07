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
    if (order.qrUsed) return setScanMsg(`El fol
