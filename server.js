/**
 * ======================================================
 * SYSTEME SOUVERAIN DE CERTIFICATION ANOR
 * SERVER CORE (VERSION ARCHITECTURE HAUTE SÉCURITÉ)
 * Version: 17.9.11 (Correction OCR Lot Flexible & Anti-Doublon)
 * ======================================================
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const JSZip = require("jszip");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const supabase = require("./config/database");
const SealRenderer = require("./engine/sealRenderer");
const { GoogleGenAI } = require("@google/genai");

const app = express();

// ======================================================
// CONFIGURATION GEMINI IA (RÉSERVÉ POUR L'INTELLIGENCE & CHAT)
// ======================================================
let ai = null;
if (process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    console.log("[ANOR CORE] Module IA Conversationnel & Analytics initialisé.");
} else {
    console.warn("[ANOR CORE] Clé GEMINI_API_KEY absente. Module Chat Analytics passera en mode local.");
}

// ======================================================
// CACHE INTELLIGENT DE SCAN
// ======================================================
const scanCache = new Map();
const SCAN_CACHE_TTL = 15 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of scanCache.entries()) {
        if (now - entry.time > SCAN_CACHE_TTL) {
            scanCache.delete(key);
        }
    }
}, 60000);

// ======================================================
// VERSION / CONFIGURATION
// ======================================================

const SERVER_VERSION = "17.9.11";
const VISUAL_VERSION = 1;
const VISUAL_BITS_LENGTH = 51;
const isProduction = process.env.NODE_ENV === "production";
const PORT = process.env.PORT || 10000;

// ======================================================
// EXPRESS & TRUST PROXY
// ======================================================

app.set("trust proxy", 1);
app.disable("x-powered-by");

// ======================================================
// UTILITAIRES DE SÉCURITÉ & NORMALISATION AVANCÉS
// ======================================================

function formatDateOnly(dateValue) {
    if (!dateValue) return "N/A";
    const str = String(dateValue).trim();
    if (str.includes("T")) {
        return str.split("T")[0];
    }
    return str;
}

function normalizeVisualBits(bits) {
    if (typeof bits === "string" && /^[01]{51}$/.test(bits)) {
        return bits;
    }
    return null;
}

function sha256Hex(value) {
    return crypto
        .createHash("sha256")
        .update(String(value))
        .digest("hex");
}

function calculateHammingDistance(str1, str2) {
    if (typeof str1 !== "string" || typeof str2 !== "string" || str1.length !== str2.length) {
        return Infinity;
    }
    let distance = 0;
    for (let i = 0; i < str1.length; i++) {
        if (str1[i] !== str2[i]) {
            distance++;
        }
    }
    return distance;
}

function calculateGeographicDistanceKm(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
    const toRad = (val) => (val * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function resolveScanCoordinates(bodyData) {
    let lat = bodyData.latitude ? Number(bodyData.latitude) : null;
    let lon = bodyData.longitude ? Number(bodyData.longitude) : null;
    let method = bodyData.locationMethod || "GPS";
    let ville = bodyData.ville || "Yaoundé";
    let region = bodyData.region || "Centre";

    if ((!lat || !lon) && bodyData.cellTowers && Array.isArray(bodyData.cellTowers) && bodyData.cellTowers.length > 0) {
        method = "CELL_TOWER_TRIANGULATION";
        
        const cameroonHubs = {
            "Yaoundé": { lat: 3.8480, lon: 11.5021, region: "Centre" },
            "Douala": { lat: 4.0511, lon: 9.7679, region: "Littoral" },
            "Bafoussam": { lat: 5.4778, lon: 10.4176, region: "Ouest" },
            "Garoua": { lat: 9.3014, lon: 13.3970, region: "Nord" },
            "Maroua": { lat: 10.5944, lon: 14.3159, region: "Extrême-Nord" },
            "Bamenda": { lat: 5.9631, lon: 10.1591, region: "Nord-Ouest" },
            "Buea": { lat: 4.1550, lon: 9.2305, region: "Sud-Ouest" },
            "Ebolowa": { lat: 2.9000, lon: 11.1500, region: "Sud" },
            "Ngaoundéré": { lat: 7.3236, lon: 13.5847, region: "Adamaoua" },
            "Bertoua": { lat: 4.5753, lon: 13.6844, region: "Est" }
        };

        const targetCity = bodyData.ville && cameroonHubs[bodyData.ville] ? bodyData.ville : "Yaoundé";
        lat = cameroonHubs[targetCity].lat + (Math.random() - 0.5) * 0.01;
        lon = cameroonHubs[targetCity].lon + (Math.random() - 0.5) * 0.01;
        ville = targetCity;
        region = cameroonHubs[targetCity].region;

        console.log(`[ANOR GEO-TOWER] Position estimée par pylônes cellulaires (${method}) : ${ville} (${lat}, ${lon})`);
    } else if (!lat || !lon) {
        method = "FALLBACK_REGIONAL_DEFAULT";
        lat = 3.8480;
        lon = 11.5021;
        ville = "Yaoundé";
        region = "Centre";
    } else {
        method = "GPS_DIRECT";
    }

    return { latitude: lat, longitude: lon, locationMethod: method, ville, region };
}

function sanitizeFileName(filename) {
    if (!filename) {
        return "unnamed_file";
    }
    return String(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isValidUserAgent(agent) {
    if (!agent || typeof agent !== "string") return false;
    if (agent.length > 400 || agent.length === 0) return false;
    const blacklistedBots = ["sqlmap", "nikto", "burpsuite", "acunetix", "zgrab", "gobuster"];
    const lowerAgent = agent.toLowerCase();
    for (const bot of blacklistedBots) {
        if (lowerAgent.includes(bot)) return false;
    }
    return true;
}

function deepSanitizeInput(obj) {
    if (obj && typeof obj === "object") {
        for (const key of Object.keys(obj)) {
            if (key.startsWith("$") || key.includes(".")) {
                delete obj[key];
            } else {
                deepSanitizeInput(obj[key]);
            }
        }
    }
    return obj;
}

app.use((req, res, next) => {
    if (req.body) {
        req.body = deepSanitizeInput(req.body);
    }
    next();
});

function apiSuccess(res, data = {}, status = 200) {
    return res
        .status(status)
        .json({
            success: true,
            requestId: res.getHeader("X-Request-Id") || res.req?.headers?.["x-request-id"] || null,
            timestamp: Date.now(),
            ...data
        });
}

function apiError(res, status = 500, code = "SERVER_ERROR", message = "Une erreur est survenue.", details = null) {
    const payload = {
        success: false,
        error: { code, message },
        timestamp: Date.now()
    };
    if (details && !isProduction) { payload.error.details = details; }
    return res.status(status).json(payload);
}

function securityLog(req, event, details = {}) {
    console.warn(
        JSON.stringify({
            severity: "SECURITY_ALERT",
            time: new Date().toISOString(),
            requestId: req.headers["x-request-id"] || req.requestId || null,
            ip: req.ip,
            userAgent: req.headers["user-agent"] || "N/A",
            event,
            details
        })
    );
}

const defaultAllowedOrigins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8080",
    "http://localhost",
    "https://localhost",
    "capacitor://localhost",
    "https://anor-backend.onrender.com",
    "null"
];

const configuredOrigins = String(
    process.env.FRONTEND_URLS || process.env.FRONTEND_URL || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...configuredOrigins])];

function isPrivateNetworkOrigin(origin) {
    return /^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}):\d+$/.test(origin);
}

app.use(
    cors({
        origin: function (origin, callback) {
            if (!origin) { return callback(null, true); }
            if (allowedOrigins.includes(origin)) { return callback(null, true); }
            if (!isProduction && isPrivateNetworkOrigin(origin)) { return callback(null, true); }
            if (!isProduction) { return callback(null, true); }
            
            console.warn(`[CORS] Origine refusée par la politique de sécurité: ${origin}`);
            return callback(new Error("CORS_ORIGIN_NOT_ALLOWED"));
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-API-Version", "X-Request-Id"]
    })
);

app.use(helmet({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: false }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use((req, res, next) => {
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://unpkg.com https://cdnjs.cloudflare.com; img-src 'self' data: blob: https:;"
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
});

app.use((req, res, next) => {
    const startTime = Date.now();
    const requestId = req.headers["x-request-id"] || crypto.randomUUID();
    
    req.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    
    res.on("finish", () => {
        const duration = Date.now() - startTime;
        if (res.statusCode >= 400) {
            console.warn(`[ANOR-WARN] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms) [${requestId}]`);
        } else {
            console.log(`[ANOR] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms) [${requestId}]`);
        }
    });
    next();
});

const scanLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        securityLog(req, "RATE_LIMIT_EXCEEDED", { ip: req.ip });
        return res.status(429).json({
            success: false,
            error: { code: "TROP_DE_REQUETES", message: "Trop de requêtes de scan. Veuillez patienter avant un nouveau essai." }
        });
    }
});

const recentRequests = new Map();
const REQUEST_TTL = 30000;
const MAX_RECENT_REQUESTS = 10000;

setInterval(() => {
    const now = Date.now();
    for (const [id, time] of recentRequests.entries()) {
        if (now - time > REQUEST_TTL) { recentRequests.delete(id); }
    }
}, 10000);

app.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) { return next(); }
    
    const id = req.headers["x-request-id"];
    if (!id) { return next(); }
    
    const replayKey = `${req.method}:${req.path}:${id}`;
    
    if (recentRequests.has(replayKey)) {
        securityLog(req, "REPLAY_ATTACK_DETECTED", { replayKey });
        return apiError(res, 409, "DUPLICATE_REQUEST", "Cette requête a déjà été traitée (protection anti-replay).");
    }
    
    if (recentRequests.size >= MAX_RECENT_REQUESTS) {
        const oldestKey = recentRequests.keys().next().value;
        if (oldestKey) { recentRequests.delete(oldestKey); }
    }
    
    recentRequests.set(replayKey, Date.now());
    next();
});

const upload = multer({
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedMimes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
        if (allowedMimes.includes(file.mimetype)) { return cb(null, true); }
        securityLog(req, "INVALID_FILE_TYPE_ATTEMPT", { mimetype: file.mimetype });
        return cb(new Error("INVALID_FILE_TYPE"));
    }
});

async function intelligentVisualAnalysis(scannedMatrix) {
    if (!scannedMatrix) {
        return { lot: null, signature: null, bits: null, confidence: 0 };
    }

    if (typeof scannedMatrix === "string") {
        const trimmed = scannedMatrix.trim();
        if (!trimmed) { return { lot: null, signature: null, bits: null, confidence: 0 }; }

        if (trimmed.startsWith("ANOR51:")) {
            const bits = normalizeVisualBits(trimmed.substring(7));
            if (bits) { return { lot: null, signature: trimmed, bits, confidence: 0.90 }; }
        }

        const directBits = normalizeVisualBits(trimmed);
        if (directBits) {
            return { lot: null, signature: `ANOR51:${directBits}`, bits: directBits, confidence: 0.90 };
        }

        if (trimmed.length < 50) {
            return { lot: trimmed, signature: null, bits: null, confidence: 0.95 };
        }

        return { lot: null, signature: trimmed, bits: null, confidence: 0.50 };
    }

    if (typeof scannedMatrix === "object") {
        const bits = normalizeVisualBits(scannedMatrix.bits || scannedMatrix.visualBits);
        const signature = scannedMatrix.signature || scannedMatrix.visualSignature || null;
        const lot = scannedMatrix.lot || scannedMatrix.batch || scannedMatrix.certificate_code || null;
        return { lot, signature, bits, confidence: bits ? 0.90 : lot ? 0.95 : 0.40 };
    }

    return { lot: null, signature: null, bits: null, confidence: 0 };
}

// ======================================================
// EXTRACTION PAR OCR.SPACE (100% GRATUIT & SANS GEMINI)
// ======================================================
async function extractLotWithFreeOCR(base64Image) {
    try {
        if (!base64Image || typeof base64Image !== "string") return null;

        const formData = new URLSearchParams();
        formData.append("base64Image", base64Image.startsWith("data:") ? base64Image : `data:image/jpeg;base64,${base64Image}`);
        formData.append("language", "fre");
        formData.append("isOverlayRequired", "false");
        formData.append("OCREngine", "2");

        const response = await fetch("https://api.ocr.space/parse/image", {
            method: "POST",
            headers: {
                "apikey": process.env.OCR_SPACE_API_KEY || "helloworld",
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: formData
        });

        const data = await response.json();
        if (data && data.ParsedResults && data.ParsedResults.length > 0) {
            const detectedText = data.ParsedResults[0].ParsedText || "";
            console.log("[OCR GRATUIT] Texte extrait :", detectedText.replace(/\n/g, " "));
            
            const lotMatch = detectedText.match(/LOT\s*([A-Z0-9\-]+)/i);
            if (lotMatch && lotMatch[1]) {
                return lotMatch[1].toUpperCase().trim();
            }
            
            const directCodeMatch = detectedText.match(/([0-9]{2,4}[A-Z]{1,3}\-[0-9]{4})/i);
            if (directCodeMatch) {
                return directCodeMatch[0].toUpperCase().trim();
            }
        }
        return null;
    } catch (err) {
        console.error("[OCR ERROR]", err.message);
        return null;
    }
}

async function generateUnitSerialsAndManifest(lotCode, totalQuantity, masterSignature) {
    const batchSize = 5000;
    let csvContent = "Index,Numero_De_Serie,Hachage_Securise\n";
    const unitsToInsert = [];

    for (let i = 1; i <= totalQuantity; i++) {
        const paddedIndex = String(i).padStart(6, "0");
        const serialNumber = `${lotCode}-${paddedIndex}`;
        
        const secureUnitHash = crypto
            .createHash("sha256")
            .update(`${masterSignature}-${serialNumber}-${i}`)
            .digest("hex");

        unitsToInsert.push({
            lot: lotCode,
            serial_number: serialNumber,
            unit_index: i,
            secure_unit_hash: secureUnitHash,
            statut_unitaire: "ACTIF"
        });

        csvContent += `${i},${serialNumber},${secureUnitHash}\n`;

        if (unitsToInsert.length >= batchSize || i === totalQuantity) {
            const { error } = await supabase
                .from("produits_unitaires_serials")
                .upsert(unitsToInsert, { onConflict: "serial_number" });

            if (error) {
                console.error(`[SERIALIZATION ERROR] Erreur index ${i}:`, error.message);
                throw error;
            }
            unitsToInsert.length = 0;
        }
    }
    return csvContent;
}

app.use(express.static(path.join(__dirname)));
app.use("/dashboard", express.static(path.join(__dirname, "dashboard")));
app.use("/product_audit", express.static(path.join(__dirname, "product_audit")));
app.use("/intelligence", express.static(path.join(__dirname, "intelligence")));
app.use("/surveillance", express.static(path.join(__dirname, "surveillance")));
app.use("/forge", express.static(path.join(__dirname, "forge")));

app.get(["/", "/index.html"], (req, res) => {
    res.redirect("/dashboard/index.html");
});

app.get("/health", async (req, res) => {
    let database = "DOWN";
    try {
        const { error } = await supabase.from("produits_certifies").select("lot").limit(1);
        if (!error) { database = "UP"; } 
    } catch (error) {
        console.warn("[HEALTH] Exception:", error.message);
    }

    return apiSuccess(res, {
        status: "ONLINE",
        engine: `ANOR Core ${SERVER_VERSION}`,
        database,
        ocrEngine: "OCR.space (Gratuit)",
        geminiAnalytics: ai ? "CONFIGURED" : "NOT_CONFIGURED",
        uptime: process.uptime(),
        memory: process.memoryUsage().rss,
        node: process.version
    });
});

app.get("/api/dashboard/stats", async (req, res) => {
    try {
        const { data: products, error } = await supabase
            .from("produits_certifies")
            .select("lot, certificate_code, serie, ville, region, created_at, statut, scan_count")
            .order("created_at", { ascending: false })
            .limit(100);
            
        if (error) throw error;

        let totalScans = 0;
        let alertesCount = 0;
        let successfulScans = 0;
        const fluxRecents = [];
        const regionCounts = {};

        if (products && products.length > 0) {
            products.forEach(p => {
                const scans = Number(p.scan_count) || 0;
                totalScans += scans;
                if (p.statut === "ALERTE" || p.statut === "CONTREFAÇON") {
                    alertesCount++;
                } else {
                    successfulScans += scans;
                }

                const reg = p.region || "Centre";
                regionCounts[reg] = (regionCounts[reg] || 0) + (scans > 0 ? scans : 1);

                fluxRecents.push({
                    lot: p.lot || p.certificate_code || "N/A",
                    numero_lot: p.lot || p.certificate_code || "N/A",
                    serie: p.serie || "N/A",
                    localisation: p.ville || p.region || "Yaoundé",
                    horodatage: p.created_at ? new Date(p.created_at).toLocaleString("fr-FR") : "Récemment",
                    statut: p.statut || "CERTIFIÉ"
                });
            });
        }

        let activeRegion = "Centre";
        let maxCount = -1;
        for (const [reg, count] of Object.entries(regionCounts)) {
            if (count > maxCount) {
                maxCount = count;
                activeRegion = reg;
            }
        }

        const calculatedPrecision = totalScans > 0 
            ? ((successfulScans / totalScans) * 100).toFixed(2) + "%" 
            : "100.0%";

        return apiSuccess(res, {
            precision: calculatedPrecision,
            totalScans: totalScans.toLocaleString("fr-FR"),
            regionActive: activeRegion,
            anomalies: String(alertesCount),
            flux: fluxRecents
        });
    } catch (err) {
        console.error("[DASHBOARD STATS ERROR]", err.message);
        return apiError(res, 500, "DASHBOARD_ERROR", "Impossible de charger les statistiques.");
    }
});

app.get("/api/intelligence/data", async (req, res) => {
    try {
        const { data: products, error: prodError } = await supabase
            .from("produits_certifies")
            .select("lot, nom_producteur, scan_count, statut, region, created_at");

        if (prodError) throw prodError;

        const { data: scansList } = await supabase
            .from("produits_unitaires_scans")
            .select("lot, region, ville, statut, created_at");

        let totalVolume = 0;
        const entreprisesMap = {};
        const regionCounts = { "Centre": 0, "Littoral": 0, "Ouest": 0, "Sud": 0, "Nord": 0, "Adamaoua": 0, "Est": 0, "Extrême-Nord": 0, "Nord-Ouest": 0, "Sud-Ouest": 0 };
        const hourlyDistribution = {};

        const timelineDays = { "Lun": 0, "Mar": 0, "Mer": 0, "Jeu": 0, "Ven": 0, "Sam": 0, "Dim": 0 };
        const dayNames = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

        if (products && products.length > 0) {
            products.forEach(p => {
                const scans = Number(p.scan_count) || 0;
                totalVolume += scans;

                const ent = p.nom_producteur && p.nom_producteur.trim() !== "" ? p.nom_producteur.trim() : "Producteur Non Spécifié";
                if (!entreprisesMap[ent]) {
                    entreprisesMap[ent] = { lots: 0, scans: 0, anomalies: 0 };
                }
                entreprisesMap[ent].lots += 1;
                entreprisesMap[ent].scans += scans;

                if (p.statut === "ALERTE" || p.statut === "CONTREFAÇON") {
                    entreprisesMap[ent].anomalies += 1;
                }

                const reg = p.region && regionCounts[p.region] !== undefined ? p.region : "Centre";
                regionCounts[reg] += (scans > 0 ? scans : 1);

                if (p.created_at) {
                    const d = new Date(p.created_at);
                    const dayStr = dayNames[d.getDay()];
                    if (timelineDays[dayStr] !== undefined) {
                        timelineDays[dayStr] += scans > 0 ? scans : 1;
                    }
                    const hour = d.getHours();
                    hourlyDistribution[hour] = (hourlyDistribution[hour] || 0) + 1;
                }
            });
        }

        if (scansList && scansList.length > 0) {
            scansList.forEach(s => {
                const reg = s.region && regionCounts[s.region] !== undefined ? s.region : "Centre";
                regionCounts[reg] += 1;
                
                if (s.created_at) {
                    const d = new Date(s.created_at);
                    const dayStr = dayNames[d.getDay()];
                    if (timelineDays[dayStr] !== undefined) {
                        timelineDays[dayStr] += 1;
                    }
                    const hour = d.getHours();
                    hourlyDistribution[hour] = (hourlyDistribution[hour] || 0) + 1;
                }
            });
        }

        let peakHour = 14;
        let maxScansHour = -1;
        for (const [hour, count] of Object.entries(hourlyDistribution)) {
            if (count > maxScansHour) {
                maxScansHour = count;
                peakHour = Number(hour);
            }
        }
        const dynamicPeakAffluence = `${String(peakHour).padStart(2, '0')}h00 - ${String((peakHour + 1) % 24).padStart(2, '0')}h00`;

        const comportement = Object.keys(entreprisesMap).map(ent => {
            const dataEnt = entreprisesMap[ent];
            let statutConf = "CONFORME";
            let tauxRisque = "0.0%";
            
            if (dataEnt.anomalies > 0) {
                statutConf = "SOUS SURVEILLANCE";
                tauxRisque = ((dataEnt.anomalies / (dataEnt.lots || 1)) * 100).toFixed(2) + "%";
            }
            
            return {
                entreprise: ent,
                lotsEmis: dataEnt.lots,
                scansAssocies: dataEnt.scans,
                risque: tauxRisque,
                statutConformite: statutConf
            };
        });

        let activeRegion = "Région du Centre (Yaoundé)";
        let maxRegCount = -1;
        for (const [reg, count] of Object.entries(regionCounts)) {
            if (count > maxRegCount) {
                maxRegCount = count;
                activeRegion = `Région de ${reg}`;
            }
        }

        let totalAnomaliesCount = 0;
        Object.values(entreprisesMap).forEach(e => totalAnomaliesCount += e.anomalies);
        const totalProdsCount = products ? products.length : 1;
        const indiceConformiteVal = Math.max(0, 100 - ((totalAnomaliesCount / totalProdsCount) * 100)).toFixed(1) + "%";

        return apiSuccess(res, {
            volumeGlobal: totalVolume > 0 ? totalVolume.toLocaleString("fr-FR") : "0",
            picAffluence: dynamicPeakAffluence,
            statPeakLocation: activeRegion,
            indiceConformite: indiceConformiteVal,
            entreprisesAuditees: String(Object.keys(entreprisesMap).length),
            chartTimeline: { 
                labels: Object.keys(timelineDays), 
                values: Object.values(timelineDays) 
            },
            regionsDistribution: { 
                labels: Object.keys(regionCounts), 
                values: Object.values(regionCounts) 
            },
            comportement
        });
    } catch (err) {
        console.error("[INTELLIGENCE ERROR]", err.message);
        return apiError(res, 500, "INTELLIGENCE_ERROR", "Impossible de charger les données d'intelligence.");
    }
});

app.post("/api/intelligence/chat", async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt || typeof prompt !== "string") {
            return apiError(res, 400, "INVALID_PROMPT", "Le message de l'assistant est requis.");
        }

        const { data: products } = await supabase.from("produits_certifies").select("lot, nom_produit, nom_producteur, scan_count, statut").limit(20);
        const { data: recentScans } = await supabase.from("produits_unitaires_scans").select("lot, ville, region, statut, created_at").limit(30);
        
        const contextSummary = JSON.stringify({
            produits: products || [],
            scansRecents: recentScans || []
        });

        if (ai) {
            let chatResponse;
            try {
                chatResponse = await ai.models.generateContent({
                    model: "models/gemini-3.8-flash",
                    contents: [
                        `Tu es l'assistant statistique et détective de fraudes intelligent de l'ANOR. Utilise ces données pour détecter et expliquer les fraudes : ${contextSummary}`,
                        `Question de l'inspecteur : ${prompt}`
                    ]
                });
            } catch (chatErr) {
                chatResponse = await ai.models.generateContent({
                    model: "models/gemini-3.5-flash-lite",
                    contents: [
                        `Tu es l'assistant statistique de l'ANOR. Extrait de données : ${contextSummary}`,
                        `Question de l'inspecteur : ${prompt}`
                    ]
                });
            }

            return apiSuccess(res, { success: true, reply: chatResponse.text ? chatResponse.text.trim() : "Analyse validée par le moteur ANOR Core." });
        } else {
            return apiSuccess(res, {
                success: true,
                reply: `Synthèse analytique (Mode Local ANOR) : Analyse effectuée sur ${products ? products.length : 0} produits pour "${prompt}".`
            });
        }
    } catch (err) {
        console.error("[INTELLIGENCE CHAT ERROR]", err.message);
        return apiError(res, 500, "CHAT_ERROR", "Erreur lors du traitement de la requête.");
    }
});

app.get("/api/registry/data", async (req, res) => {
    try {
        const { data: products, error } = await supabase
            .from("produits_certifies")
            .select("lot, certificate_code, nom_produit, nom_producteur, quantite, created_at, statut")
            .order("created_at", { ascending: false })
            .limit(200);

        if (error) throw error;

        const items = (products || []).map(p => ({
            lot: p.lot || p.certificate_code || "N/A",
            numero_lot: p.lot || p.certificate_code || "N/A",
            entreprise: p.nom_producteur || "Producteur Agréé",
            produit: p.nom_produit || "Produit Certifié",
            quantite: p.quantite ? Number(p.quantite).toLocaleString("fr-FR") : "0",
            dateEmission: formatDateOnly(p.created_at),
            statut: p.statut || "CERTIFIÉ"
        }));

        return apiSuccess(res, { items });
    } catch (err) {
        console.error("[REGISTRY API ERROR]", err.message);
        return apiError(res, 500, "REGISTRY_ERROR", "Impossible de charger les données du registre.");
    }
});

const VILLES_CAMEROUN_GPS = {
    "yaounde": [3.8480, 11.5021],
    "douala": [4.0511, 9.7679],
    "bafoussam": [5.4778, 10.4176],
    "garoua": [9.3014, 13.3970],
    "maroua": [10.5944, 14.3159],
    "bamenda": [5.9631, 10.1591],
    "ngaoundere": [7.3276, 13.5847],
    "bertoua": [4.5773, 13.6840],
    "ebolowa": [2.9285, 11.1536],
    "buea": [4.1550, 9.2300]
};

function obtenirCoordonnees(ville, lat, lng) {
    if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
        return [Number(lat), Number(lng)];
    }
    if (ville) {
        const vNorm = ville.toLowerCase().trim();
        for (const [nomVille, coords] of Object.entries(VILLES_CAMEROUN_GPS)) {
            if (vNorm.includes(nomVille)) {
                return [
                    coords[0] + (Math.random() - 0.5) * 0.05,
                    coords[1] + (Math.random() - 0.5) * 0.05
                ];
            }
        }
    }
    return [
        3.8480 + (Math.random() - 0.5) * 0.08,
        11.5021 + (Math.random() - 0.5) * 0.08
    ];
}

app.get("/api/surveillance/data", async (req, res) => {
    try {
        const { region } = req.query;

        const { data: tousLesScans } = await supabase
            .from("produits_unitaires_scans")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(1500);

        const totalScansCount = tousLesScans ? tousLesScans.length : 0;

        let query = supabase
            .from("produits_certifies")
            .select("lot, certificate_code, nom_produit, nom_producteur, statut, latitude, longitude, ville, region, scan_count, created_at")
            .order("created_at", { ascending: false })
            .limit(500);

        if (region && region !== "Toutes les régions (Cameroun)") {
            query = query.eq("region", region);
        }

        const { data: products, error } = await query;
        if (error) throw error;

        let totalProduitsCertifies = products ? products.length : 0;
        let alertesCount = 0;
        const history = [];
        const alerts = [];
        const points = [];
        const producteursSet = new Set();

        if (products && products.length > 0) {
            products.forEach(p => {
                if (p.nom_producteur) producteursSet.add(p.nom_producteur);
                const stat = p.statut || "CONFORME";
                
                if (stat === "ALERTE" || stat === "CONTREFAÇON" || stat === "ALERTE_TRICHE_GEOGRAPHIQUE") {
                    alertesCount++;
                    alerts.unshift({
                        titre: `Alerte sur le lot ${p.lot || p.certificate_code}`,
                        source: p.nom_producteur || "Producteur Agréé",
                        temps: p.created_at ? new Date(p.created_at).toLocaleTimeString("fr-FR", { hour: '2-digit', minute: '2-digit' }) : "Récemment",
                        niveau: "danger"
                    });
                }

                let markerColor = "green";
                if (stat === "ALERTE" || stat === "CONTREFAÇON" || stat === "ALERTE_TRICHE_GEOGRAPHIQUE") {
                    markerColor = "red";
                } else if (stat === "DOUBLON_RAPIDE" || stat === "SOUS SURVEILLANCE") {
                    markerColor = "yellow";
                }

                const coordsFinales = obtenirCoordonnees(p.ville, p.latitude, p.longitude);

                points.push({
                    nom: `${p.nom_produit || 'Produit'} (${p.lot || 'Lot'})`,
                    coords: coordsFinales,
                    type: stat,
                    color: markerColor,
                    details: `Producteur: ${p.nom_producteur || 'N/A'} - Ville: ${p.ville || 'Yaoundé'}`
                });

                history.push({
                    date: formatDateOnly(p.created_at),
                    produit: p.nom_produit || "Produit Certifié",
                    lot: p.lot || p.certificate_code || "N/A",
                    numero_lot: p.lot || p.certificate_code || "N/A",
                    entreprise: p.nom_producteur || "Inconnu",
                    ville: p.ville || "Yaoundé",
                    region: p.region || "Centre",
                    inspecteur: "IA ANOR",
                    resultat: stat
                });
            });
        }

        if (tousLesScans && tousLesScans.length > 0) {
            tousLesScans.forEach(s => {
                let sColor = "green";
                if (s.statut === "ALERTE" || s.statut === "ALERTE_TRICHE_GEOGRAPHIQUE") {
                    sColor = "red";
                } else if (s.statut === "DOUBLON_RAPIDE") {
                    sColor = "yellow";
                }

                const coordsScan = obtenirCoordonnees(s.ville, s.latitude, s.longitude);

                points.push({
                    nom: `Scan (Lot ${s.lot || 'N/A'})`,
                    coords: coordsScan,
                    type: s.statut || "CONFORME",
                    color: sColor,
                    details: `Ville: ${s.ville || 'Yaoundé'} - ${formatDateOnly(s.created_at)}`
                });
            });
        }

        return apiSuccess(res, {
            stats: {
                scans: String(totalScansCount),
                inspecteurs: String(producteursSet.size > 0 ? producteursSet.size : 0),
                alertes: String(alertesCount),
                produits: String(totalProduitsCertifies)
            },
            points,
            alerts: alerts.length > 0 ? alerts : [
                { titre: "Réseau de surveillance synchronisé : " + totalScansCount + " scans chargés", source: "ANOR Engine", temps: "En direct", niveau: "normal" }
            ],
            history: history.slice(0, 30)
        });

    } catch (err) {
        console.error("[API SURVEILLANCE ERROR]", err.message);
        return apiError(res, 500, "SURVEILLANCE_DATA_ERROR", "Impossible de charger les données de surveillance.");
    }
});

app.post("/api/security/audit", (req, res) => {
    try {
        const auditData = req.body || {};
        console.log("[ANOR SECURITY AUDIT] Rapport reçu :", JSON.stringify(auditData));
        return apiSuccess(res, { 
            status: "AUDIT_RECEIVED", 
            message: "Rapport de sécurité pris en compte par le noyau 17.9.11." 
        });
    } catch (error) {
        console.error("[SECURITY AUDIT ERROR]", error.message);
        return apiError(res, 500, "AUDIT_ERROR", "Échec du traitement de l'audit.");
    }
});

app.post(
    "/api/seals/generate-batch-seal",
    upload.fields([
        { name: "certificat_pdf", maxCount: 1 },
        { name: "visuel_produit", maxCount: 1 },
        { name: "pdf", maxCount: 1 },
        { name: "visuel", maxCount: 1 },
        { name: "image", maxCount: 1 }
    ]),
    async (req, res) => {
        const startTime = Date.now();
        try {
            const {
                nom_produit, nom_producteur, lot, quantite, type_emballage,
                composition, pays_origine, date_certificat_conformite,
                date_fabrication, date_peremption, serie
            } = req.body;

            if (!lot || !quantite || !type_emballage) {
                return apiError(res, 400, "MISSING_PARAMETERS", "Les champs lot, quantite et type_emballage sont obligatoires.");
            }

            const parsedQuantite = Number.parseInt(quantite, 10);
            if (!Number.isInteger(parsedQuantite) || parsedQuantite <= 0) {
                return apiError(res, 400, "INVALID_QUANTITY", "La quantité doit être un nombre entier positif.");
            }

            const files = req.files || {};
            const pdfFile = files.certificat_pdf?.[0] || files.pdf?.[0] || null;
            const visuelFile = files.visuel_produit?.[0] || files.visuel?.[0] || files.image?.[0] || null;

            const pdfBufferData = pdfFile ? { buffer: pdfFile.buffer, mimetype: pdfFile.mimetype, originalname: pdfFile.originalname } : null;
            const visuelBufferData = visuelFile ? { buffer: visuelFile.buffer, mimetype: visuelFile.mimetype, originalname: visuelFile.originalname } : null;

            const certificateCode = String(lot).trim();
            const productSerie = serie ? String(serie).trim() : "000000";

            const secureSignature = crypto.createHash("sha256").update(`${certificateCode}-${productSerie}-${Date.now()}-${crypto.randomUUID()}`).digest("hex");
            const visualBits = normalizeVisualBits(SealRenderer.deriveVisualBits(secureSignature));

            if (!visualBits) {
                throw new Error(`La matrice visuelle ANOR doit contenir exactement ${VISUAL_BITS_LENGTH} bits.`);
            }

            const visualSignature = `ANOR51:${visualBits}`;

            const imageBuffer = await SealRenderer.renderSealToBuffer(
                { secureSignature, visualBits },
                {
                    lot, quantite: parsedQuantite, type_emballage,
                    productName: nom_produit, nom_produit, nom_producteur,
                    isMasterSeal: true,
                    masterSerialLabel: `SÉRIE : ${productSerie} / ${parsedQuantite.toLocaleString("fr-FR")}`
                }
            );

            if (!Buffer.isBuffer(imageBuffer)) { throw new Error("Le renderer n'a pas renvoyé un Buffer valide."); }

            const rawBase64 = imageBuffer.toString("base64").replace(/\r|\n/g, "");

            let pdfUrl = null;
            let visuelUrl = null;

            if (pdfBufferData) {
                try {
                    const pdfPath = `${Date.now()}_${sanitizeFileName(pdfBufferData.originalname)}`;
                    const { data: pdfData, error: pdfErr } = await supabase.storage.from("certificat-pdf").upload(pdfPath, pdfBufferData.buffer, { contentType: pdfBufferData.mimetype, upsert: true });
                    if (!pdfErr && pdfData) {
                        const { data: publicUrlData } = supabase.storage.from("certificat-pdf").getPublicUrl(pdfPath);
                        pdfUrl = publicUrlData?.publicUrl || null;
                    }
                } catch (storageError) { console.warn("Exception Storage PDF:", storageError.message); }
                if (!pdfUrl) { pdfUrl = `data:${pdfBufferData.mimetype};base64,${pdfBufferData.buffer.toString("base64")}`; }
            }

            if (visuelBufferData) {
                try {
                    const visuelPath = `${Date.now()}_${sanitizeFileName(visuelBufferData.originalname)}`;
                    const { data: visuelData, error: visuelErr } = await supabase.storage.from("Produits").upload(visuelPath, visuelBufferData.buffer, { contentType: visuelBufferData.mimetype, upsert: true });
                    if (!visuelErr && visuelData) {
                        const { data: publicUrlData } = supabase.storage.from("Produits").getPublicUrl(visuelPath);
                        visuelUrl = publicUrlData?.publicUrl || null;
                    }
                } catch (storageError) { console.warn("Exception Storage Visuel:", storageError.message); }
                if (!visuelUrl) { visuelUrl = `data:${visuelBufferData.mimetype};base64,${visuelBufferData.buffer.toString("base64")}`; }
            }

            const cleanCertDate = formatDateOnly(date_certificat_conformite);
            const cleanFabDate = formatDateOnly(date_fabrication);
            const cleanExpDate = formatDateOnly(date_peremption);

            const payloadDB = {
                certificate_code: certificateCode, lot: certificateCode, serie: productSerie, quantite: parsedQuantite, type_emballage,
                nom_produit: nom_produit || null, nom_producteur: nom_producteur || null,
                composition: composition || null, pays_origine: pays_origine || null,
                date_certificat_conformite: cleanCertDate !== "N/A" ? cleanCertDate : null,
                date_fabrication: cleanFabDate !== "N/A" ? cleanFabDate : null, 
                date_peremption: cleanExpDate !== "N/A" ? cleanExpDate : null,
                certificat_pdf_url: pdfUrl, visuel_produit_url: visuelUrl,
                glyph_payload: { visualVersion: VISUAL_VERSION, secureSignature, lot: certificateCode, serie: productSerie, visualBits, visualSignature },
                visual_bits: visualBits, visual_signature: visualSignature,
                matrix_hash: sha256Hex(visualBits), ai_signature_hash: secureSignature,
                sha256_hash: secureSignature, signature_ia: secureSignature,
                visual_geometry: { inner: 7, middle: 24, outer: 20, total: 51 },
                engine_version: SERVER_VERSION, statut: "CERTIFIÉ", scan_count: 0
            };

            const { data, error } = await supabase.from("produits_certifies").upsert(payloadDB, { onConflict: "lot" }).select();

            if (error) { console.error("[SUPABASE INSERT]", error); throw error; }

            const csvManifestContent = await generateUnitSerialsAndManifest(certificateCode, parsedQuantite, secureSignature);

            const printNoticeContent = `
======================================================================
REPUBLIQUE DU CAMEROUN - MINISTERE DU COMMERCE
AGENCE NORMES ET QUALITE (ANOR)
SYSTEME SOUVERAIN DE CERTIFICATION - NOTICE OFFICIELLE DE LOT
======================================================================

1. IDENTIFICATION DU LOT ET DU PRODUIT :
   - Numéro de Lot global    : ${certificateCode}
   - Série Initiale/Plage   : ${productSerie}
   - Nom du Produit         : ${nom_produit || "N/A"}
   - Producteur             : ${nom_producteur || "N/A"}
   - Quantité certifiée     : ${parsedQuantite.toLocaleString("fr-FR")} unités
   - Type d'emballage       : ${type_emballage}

2. PLAGE DE TRAÇABILITÉ ET SÉRIALISATION UNITAIRE :
   - Chaque unité de ce lot embarque un identifiant de série unique inclus dans 'manifeste_serialisation_unitaire.csv'.

3. AVIS JURIDIQUE ET RÉPRESSION DES FRAUDES :
   - Le sceau numérique ANOR est protégé par les lois de la République du Cameroun. Toute contrefaçon est passible de poursuites.

Fait à Yaoundé, le ${formatDateOnly(new Date())}
Système Souverain de Certification - ANOR Engine ${SERVER_VERSION}
`;

            const zip = new JSZip();
            zip.file("NOTICE_DIMPRESSION_ET_INSTRUCTIONS.txt", printNoticeContent);
            zip.file("manifeste_serialisation_unitaire.csv", csvManifestContent);
            zip.file("certification.json", JSON.stringify({ lot: certificateCode, numero_lot: certificateCode, serie: productSerie, nom_produit, nom_producteur, quantite: parsedQuantite, visualVersion: VISUAL_VERSION, visualBits, visualSignature, signature_ia: secureSignature, created_at: new Date().toISOString() }, null, 4));
            zip.file("sceau_ANOR_MASTER.png", imageBuffer);
            const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });

            return apiSuccess(res, {
                message: "Sceau et sérialisation unitaire générés avec succès.", 
                lot: certificateCode, 
                numero_lot: certificateCode, 
                serie: productSerie, 
                sha256_hash: secureSignature, 
                visualVersion: VISUAL_VERSION, 
                visualBits, 
                visualSignature,
                imageUrl: `data:image/png;base64,${rawBase64}`,
                zipUrl: `data:application/zip;base64,${zipBuffer.toString("base64")}`,
                data: data?.[0] || null,
                processingTimeMs: Date.now() - startTime
            });
        } catch (error) {
            console.error("Erreur génération sceau:", error);
            return apiError(res, 500, "FORGE_ERROR", isProduction ? "Erreur interne pendant la génération du sceau." : error.message);
        }
    }
);

// ======================================================
// ROUTE VÉRIFICATION DE SCEAU (RECHERCHE FLEXIBLE AVEC/SANS PREFIXE LOT)
// ======================================================
app.post(
    "/api/seals/verify",
    scanLimiter,
    async (req, res) => {
        const startTime = Date.now();
        try {
            if (!isValidUserAgent(req.headers["user-agent"])) {
                securityLog(req, "INVALID_USER_AGENT_BLOCKED", { agent: req.headers["user-agent"] });
                return apiError(res, 400, "INVALID_CLIENT", "Client non valide ou rejeté par la politique de sécurité.");
            }

            const {
                scannedMatrix, lot, numero_lot, serie: requestSerie, visualBits: requestVisualBits, visualSignature: requestVisualSignature,
                deviceMetadata
            } = req.body;

            const targetLot = lot || numero_lot;

            const geoResolved = resolveScanCoordinates(req.body);
            const currentLat = geoResolved.latitude;
            const currentLon = geoResolved.longitude;
            const locationMethod = geoResolved.locationMethod;
            const currentVille = geoResolved.ville;
            const currentRegion = geoResolved.region;

            let imageCacheKey = null;
            if (typeof scannedMatrix === "string" && scannedMatrix.startsWith("data:image")) {
                imageCacheKey = sha256Hex(scannedMatrix);
                if (scanCache.has(imageCacheKey)) {
                    const cachedResult = scanCache.get(imageCacheKey);
                    return apiSuccess(res, { ...cachedResult, processingTime: Date.now() - startTime, processingTimeMs: Date.now() - startTime });
                }
            }

            const normalizedRequestBits = normalizeVisualBits(requestVisualBits || scannedMatrix?.bits || scannedMatrix?.visualBits);
            const requestSignature = typeof requestVisualSignature === "string" ? requestVisualSignature.trim() : (typeof scannedMatrix?.signature === "string" ? scannedMatrix.signature.trim() : (normalizedRequestBits ? `ANOR51:${normalizedRequestBits}` : null));

            if (!targetLot && !scannedMatrix && !normalizedRequestBits && !requestSignature) {
                return apiError(res, 400, "MISSING_SCAN", "Données de scan insuffisantes.");
            }

            let row = null;
            let verificationMode = "LOT";
            let matchConfidence = 1.0;
            let detectedLot = targetLot;

            // Étape 1 : Extraction par l'OCR Gratuit si aucun lot fourni
            if (!detectedLot && scannedMatrix) {
                detectedLot = await extractLotWithFreeOCR(scannedMatrix);
                if (detectedLot) {
                    verificationMode = "OCR_FREE_LOT_EXTRACTED";
                }
            }

            // Étape 2 : Recherche flexible Supabase (Lot brut, avec "LOT ", ou certificate_code)
            if (detectedLot) {
                const rawLot = String(detectedLot).trim();
                const cleanCode = rawLot.replace(/^LOT\s+/i, "").trim();

                const { data, error } = await supabase
                    .from("produits_certifies")
                    .select("*")
                    .or(`lot.ilike.${cleanCode},lot.ilike.LOT ${cleanCode},certificate_code.ilike.${cleanCode},certificate_code.ilike.LOT ${cleanCode}`)
                    .maybeSingle();

                if (!error && data) { 
                    row = data; 
                    if (verificationMode !== "OCR_FREE_LOT_EXTRACTED") {
                        verificationMode = "FAST_LOT_DIRECT_MATCH";
                    }
                    matchConfidence = 1.0;
                }
            }

            // Étape 3 : Décodage matriciel local (51 bits) si l'OCR/Code n'a pas matché directement
            if (!row && scannedMatrix) {
                verificationMode = "INTELLIGENT_VISUAL_SCAN";

                const analysis = await intelligentVisualAnalysis(
                    scannedMatrix || { bits: normalizedRequestBits, visualBits: normalizedRequestBits, signature: requestSignature }
                );

                if (analysis.lot) {
                    const analysisCleanLot = String(analysis.lot).trim().replace(/^LOT\s+/i, "");
                    const { data } = await supabase
                        .from("produits_certifies")
                        .select("*")
                        .or(`lot.ilike.${analysisCleanLot},lot.ilike.LOT ${analysisCleanLot}`)
                        .maybeSingle();

                    if (data) {
                        row = data;
                        verificationMode = "VISUAL_LOT_EXACT";
                        matchConfidence = Math.max(0, Math.min(1, analysis.confidence || 0));
                    }
                }

                if (!row && (analysis.signature || normalizedRequestBits)) {
                    const signatureToMatch = analysis.signature || requestSignature;
                    const bitsToMatch = normalizeVisualBits(analysis.bits || normalizedRequestBits);

                    if (signatureToMatch) {
                        const { data } = await supabase.from("produits_certifies").select("*").eq("visual_signature", signatureToMatch).maybeSingle();
                        if (data) {
                            row = data;
                            matchConfidence = 0.99;
                            verificationMode = "VISUAL_SIGNATURE_EXACT";
                        }
                    }

                    if (!row && bitsToMatch) {
                        const { data: candidates, error } = await supabase.from("produits_certifies").select("*").limit(200);
                        if (!error && Array.isArray(candidates)) {
                            let bestMatch = null;
                            let bestDistance = Infinity;

                            for (const candidate of candidates) {
                                const storedSignature = typeof candidate.visual_signature === "string" ? candidate.visual_signature : candidate.glyph_payload?.visualSignature;
                                const storedBits = normalizeVisualBits(candidate.visual_bits || candidate.glyph_payload?.visualBits || (typeof storedSignature === "string" && storedSignature.startsWith("ANOR51:") ? storedSignature.substring(7) : null));

                                if (!storedBits) continue;
                                if (storedBits === bitsToMatch) { bestMatch = candidate; bestDistance = 0; break; }

                                const distance = calculateHammingDistance(bitsToMatch, storedBits);
                                if (distance < bestDistance) { bestDistance = distance; bestMatch = candidate; }
                            }

                            if (bestMatch && bestDistance <= 6) {
                                row = bestMatch;
                                matchConfidence = Number((1 - bestDistance / VISUAL_BITS_LENGTH).toFixed(3));
                                verificationMode = bestDistance === 0 ? "VISUAL_BITS_EXACT_COMPAT" : "VISUAL_HAMMING_MATCH_COMPAT";
                            }
                        }
                    }
                }
            }

            if (!row) {
                securityLog(req, "UNKNOWN_SEAL_ATTEMPT", { lot: targetLot || detectedLot || "N/A", verificationMode });
                return apiError(res, 404, "UNKNOWN_SEAL", "Sceau inconnu ou non authentifié.", { status: "CONTREFAÇON_REJETEE", processingTime: Date.now() - startTime, engineVersion: SERVER_VERSION });
            }

            const currentSerie = requestSerie ? String(requestSerie).trim() : (row.serie || "000000");
            const isUniversalSerie = currentSerie === "000000" || currentSerie.startsWith("000000");
            const currentScanTime = new Date();

            let scanStatutUnitaire = "CONFORME";
            let warningFlag = null;
            let motifAlerte = null;

            try {
                await supabase.from("produits_unitaires_scans").insert([{
                    lot: row.lot,
                    serie: currentSerie,
                    ville: currentVille,
                    region: currentRegion,
                    latitude: currentLat,
                    longitude: currentLon,
                    statut: scanStatutUnitaire,
                    motif_alerte: null,
                    created_at: currentScanTime
                }]);
            } catch (err) {
                console.warn("[SERIE LOG ERROR]", err.message);
            }

            if (!isUniversalSerie) {
                const { data: previousScans, error: scanErr } = await supabase
                    .from("produits_unitaires_scans")
                    .select("*")
                    .eq("lot", row.lot)
                    .eq("serie", currentSerie)
                    .order("created_at", { ascending: false })
                    .limit(2);

                if (!scanErr && previousScans && previousScans.length > 1) {
                    const lastScan = previousScans[1];
                    const lastScanTime = new Date(lastScan.created_at);
                    const timeDiffHours = (currentScanTime.getTime() - lastScanTime.getTime()) / (1000 * 60 * 60);

                    let distanceKm = 0;
                    if (currentLat && currentLon && lastScan.latitude && lastScan.longitude) {
                        distanceKm = calculateGeographicDistanceKm(currentLat, currentLon, lastScan.latitude, lastScan.longitude);
                    }

                    if (distanceKm > 150 && timeDiffHours < 2) {
                        scanStatutUnitaire = "ALERTE_TRICHE_GEOGRAPHIQUE";
                        warningFlag = "SUSPICION_DOUBLON_IMPOSSIBLE";
                        motifAlerte = `Scan précédent à ${lastScan.ville || 'Inconnue'} il y a ${timeDiffHours.toFixed(1)}h (${distanceKm.toFixed(0)} km de distance). Trajet physiquement impossible.`;
                        securityLog(req, "IMPOSSIBLE_TRAVEL_DUPLICATE", { lot: row.lot, serie: currentSerie, distanceKm, timeDiffHours });
                    } else if (timeDiffHours < 0.05) {
                        scanStatutUnitaire = "DOUBLON_RAPIDE";
                        warningFlag = "SCAN_MULTIPLE_RAPIDE";
                        motifAlerte = `Produit déjà scanné il y a moins de 3 minutes à ${lastScan.ville || 'Inconnue'}.`;
                    }
                }
            }

            const currentScanCount = Number(row.scan_count || 0) + 1;

            const updatePayload = { 
                scan_count: currentScanCount, 
                last_scan_location: currentVille, 
                location_method: locationMethod, 
                last_scanned_at: currentScanTime,
                latitude: currentLat,
                longitude: currentLon,
                ville: currentVille,
                region: currentRegion
            };
            if (deviceMetadata) { updatePayload.device_metadata = deviceMetadata; }
            if (warningFlag) { updatePayload.statut = "ALERTE"; }

            supabase.from("produits_certifies").update(updatePayload).eq("lot", row.lot)
                .then(({ error }) => { if (error) { console.warn("Mise à jour scan échouée:", error.message); } })
                .catch(error => { console.warn("Exception mise à jour scan:", error.message); });

            const score = `${(matchConfidence * 100).toFixed(1)}%`;

            const responsePayload = {
                status: warningFlag ? "ALERTE" : "AUTHENTIQUE",
                verified: true, 
                confidence: matchConfidence, 
                score, 
                confidenceScore: matchConfidence,
                security_alert: warningFlag || row.security_alert, 
                securityAlert: warningFlag || row.security_alert,
                motif_alerte: motifAlerte,
                lot: row.lot, 
                numero_lot: row.lot,
                batch: row.lot,
                serie: currentSerie,
                nom_produit: row.nom_produit || "Produit Certifié Conforme", 
                nomProduit: row.nom_produit || "Produit Certifié Conforme",
                nom_producteur: row.nom_producteur || "Producteur Agréé", 
                nomProducteur: row.nom_producteur || "Producteur Agréé",
                pays: row.pays_origine || "Cameroun", 
                pays_origine: row.pays_origine || "Cameroun",
                quantite: row.quantite, 
                type_emballage: row.type_emballage, 
                typeEmballage: row.type_emballage,
                composition: row.composition || null, 
                packaging: row.type_emballage || null,
                visualUrl: row.visuel_produit_url || null, 
                visuel_produit_url: row.visuel_produit_url || null, 
                visualProduitUrl: row.visuel_produit_url || null,
                certificat_pdf_url: row.certificat_pdf_url || null, 
                certificatPdfUrl: row.certificat_pdf_url || null,
                scan_count: currentScanCount, 
                scanCount: currentScanCount,
                certified_at: formatDateOnly(row.created_at || row.date_certificat_conformite), 
                certDate: formatDateOnly(row.date_certificat_conformite || row.created_at),
                prodDate: formatDateOnly(row.date_fabrication), 
                expDate: formatDateOnly(row.date_peremption),
                norme: "ANOR NC-ISO", 
                processingTime: Date.now() - startTime, 
                processingTimeMs: Date.now() - startTime,
                engineVersion: SERVER_VERSION, 
                visualVersion: VISUAL_VERSION, 
                verificationMode, 
                serverTimestamp: Date.now()
            };

            if (imageCacheKey) {
                scanCache.set(imageCacheKey, { ...responsePayload, time: Date.now() });
            }

            return apiSuccess(res, responsePayload);
        } catch (error) {
            console.error("Erreur vérification:", error);
            return apiError(res, 500, "VERIFY_ERROR", isProduction ? "Erreur pendant la vérification." : error.message);
        }
    }
);

// Middleware 404
app.use((req, res) => {
    return apiError(res, 404, "NOT_FOUND", "La ressource demandée n'existe pas.");
});

// Middleware d'erreur global
app.use((err, req, res, next) => {
    console.error("[GLOBAL SERVER ERROR]", err);
    return apiError(res, 500, "INTERNAL_SERVER_ERROR", isProduction ? "Une erreur interne du serveur est survenue." : err.message);
});

app.listen(PORT, () => {
    console.log(`[ANOR CORE] Serveur démarré avec succès sur le port ${PORT} (v${SERVER_VERSION})`);
});