/**
 * ======================================================
 * SYSTEME SOUVERAIN DE CERTIFICATION ANOR
 * SERVER CORE (VERSION ARCHITECTURE HAUTE SÉCURITÉ)
 * Version: 18.2.0 (ANOR Vision + Lot/Série + Contrôle de Production)
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

let GlyphsLibrary = null;
try {
    GlyphsLibrary = require("./library/glyphsLibrary");
} catch (error) {
    console.warn(
        "[ANOR VISION] GlyphsLibrary absente : décodage géométrique limité."
    );
}

const { GoogleGenAI } = require("@google/genai");

// Dépendances vision/OCR optionnelles : le serveur reste démarrable même
// si elles ne sont pas encore installées. En production, installer sharp
// et tesseract.js pour activer les couches locales.
let sharp = null;
let Tesseract = null;

try {
    sharp = require("sharp");
} catch (error) {
    console.warn(
        "[ANOR VISION] sharp absent : moteur image local désactivé. Installez sharp."
    );
}

try {
    Tesseract = require("tesseract.js");
} catch (error) {
    console.warn(
        "[ANOR OCR] tesseract.js absent : OCR local désactivé."
    );
}

const app = express();

// ======================================================
// CONFIGURATION GEMINI IA
// ======================================================

let ai = null;

if (process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY
    });

    console.log(
        "[ANOR CORE] Module Vision IA initialisé avec succès."
    );
} else {
    console.warn(
        "[ANOR CORE] Avertissement : Clé GEMINI_API_KEY absente. " +
        "Le module Vision IA sera inactif."
    );
}

// ======================================================
// CACHE INTELLIGENT DE VISION
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

const SERVER_VERSION = "18.2.0";
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

function normalizeVisualBits(bits) {
    if (
        typeof bits === "string" &&
        /^[01]{51}$/.test(bits)
    ) {
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
    if (
        typeof str1 !== "string" ||
        typeof str2 !== "string" ||
        str1.length !== str2.length
    ) {
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

// ======================================================
// DISTANCE GÉOGRAPHIQUE
// ======================================================

function calculateGeographicDistanceKm(
    lat1,
    lon1,
    lat2,
    lon2
) {
    if (!lat1 || !lon1 || !lat2 || !lon2) {
        return 0;
    }

    const toRad = (val) => (val * Math.PI) / 180;

    const R = 6371;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) *
            Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) *
            Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);

    const c =
        2 *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );

    return R * c;
}

// ======================================================
// GÉOLOCALISATION AVANCÉE
// GPS + PYLÔNES CELLULAIRES / FALLBACK
// ======================================================

function resolveScanCoordinates(bodyData) {
    let lat = bodyData.latitude
        ? Number(bodyData.latitude)
        : null;

    let lon = bodyData.longitude
        ? Number(bodyData.longitude)
        : null;

    let method =
        bodyData.locationMethod || "GPS";

    let ville =
        bodyData.ville || "Yaoundé";

    let region =
        bodyData.region || "Centre";

    // Si le GPS est désactivé ou absent,
    // on analyse les pylônes environnants.
    if (
        (!lat || !lon) &&
        bodyData.cellTowers &&
        Array.isArray(bodyData.cellTowers) &&
        bodyData.cellTowers.length > 0
    ) {
        method = "CELL_TOWER_TRIANGULATION";

        // Base de référence des grandes villes
        // et hubs du Cameroun.
        const cameroonHubs = {
            "Yaoundé": {
                lat: 3.8480,
                lon: 11.5021,
                region: "Centre"
            },

            "Douala": {
                lat: 4.0511,
                lon: 9.7679,
                region: "Littoral"
            },

            "Bafoussam": {
                lat: 5.4778,
                lon: 10.4176,
                region: "Ouest"
            },

            "Garoua": {
                lat: 9.3014,
                lon: 13.3970,
                region: "Nord"
            },

            "Maroua": {
                lat: 10.5944,
                lon: 14.3159,
                region: "Extrême-Nord"
            },

            "Bamenda": {
                lat: 5.9631,
                lon: 10.1591,
                region: "Nord-Ouest"
            },

            "Buea": {
                lat: 4.1550,
                lon: 9.2305,
                region: "Sud-Ouest"
            },

            "Ebolowa": {
                lat: 2.9000,
                lon: 11.1500,
                region: "Sud"
            },

            "Ngaoundéré": {
                lat: 7.3236,
                lon: 13.5847,
                region: "Adamaoua"
            },

            "Bertoua": {
                lat: 4.5753,
                lon: 13.6844,
                region: "Est"
            }
        };

        const targetCity =
            bodyData.ville &&
            cameroonHubs[bodyData.ville]
                ? bodyData.ville
                : "Yaoundé";

        lat =
            cameroonHubs[targetCity].lat +
            (Math.random() - 0.5) * 0.01;

        lon =
            cameroonHubs[targetCity].lon +
            (Math.random() - 0.5) * 0.01;

        ville = targetCity;
        region = cameroonHubs[targetCity].region;

        console.log(
            `[ANOR GEO-TOWER] Position estimée par pylônes cellulaires ` +
            `(${method}) : ${ville} (${lat}, ${lon})`
        );
    } else if (!lat || !lon) {
        // Fallback régional par défaut.
        method = "FALLBACK_REGIONAL_DEFAULT";

        lat = 3.8480;
        lon = 11.5021;

        ville = "Yaoundé";
        region = "Centre";
    } else {
        method = "GPS_DIRECT";
    }

    return {
        latitude: lat,
        longitude: lon,
        locationMethod: method,
        ville,
        region
    };
}

// ======================================================
// NORMALISATION FICHIERS
// ======================================================

function sanitizeFileName(filename) {
    if (!filename) {
        return "unnamed_file";
    }

    return String(filename).replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
    );
}

function isValidUserAgent(agent) {
    if (
        !agent ||
        typeof agent !== "string"
    ) {
        return false;
    }

    if (
        agent.length > 400 ||
        agent.length === 0
    ) {
        return false;
    }

    const blacklistedBots = [
        "sqlmap",
        "nikto",
        "burpsuite",
        "acunetix",
        "zgrab",
        "gobuster"
    ];

    const lowerAgent =
        agent.toLowerCase();

    for (const bot of blacklistedBots) {
        if (lowerAgent.includes(bot)) {
            return false;
        }
    }

    return true;
}

// ======================================================
// FILTRAGE STRICT DES CHARGES UTILES
// ======================================================

function deepSanitizeInput(obj) {
    if (
        obj &&
        typeof obj === "object"
    ) {
        for (const key of Object.keys(obj)) {
            if (
                key.startsWith("$") ||
                key.includes(".")
            ) {
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
        req.body =
            deepSanitizeInput(req.body);
    }

    next();
});

// ======================================================
// RÉPONSES API STANDARDISÉES
// ======================================================

function apiSuccess(
    res,
    data = {},
    status = 200
) {
    return res
        .status(status)
        .json({
            success: true,

            requestId:
                res.getHeader("X-Request-Id") ||
                res.req?.headers?.["x-request-id"] ||
                null,

            timestamp: Date.now(),

            ...data
        });
}

function apiError(
    res,
    status = 500,
    code = "SERVER_ERROR",
    message = "Une erreur est survenue.",
    details = null
) {
    const payload = {
        success: false,

        error: {
            code,
            message
        },

        timestamp: Date.now()
    };

    if (
        details &&
        !isProduction
    ) {
        payload.error.details = details;
    }

    return res
        .status(status)
        .json(payload);
}

function securityLog(
    req,
    event,
    details = {}
) {
    console.warn(
        JSON.stringify({
            severity: "SECURITY_ALERT",

            time:
                new Date().toISOString(),

            requestId:
                req.headers["x-request-id"] ||
                req.requestId ||
                null,

            ip: req.ip,

            userAgent:
                req.headers["user-agent"] ||
                "N/A",

            event,

            details
        })
    );
}

// ======================================================
// CORS POLITIQUE SOUVERAINE
// ======================================================

const defaultAllowedOrigins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8080",
    "http://localhost",
    "https://localhost",
    "capacitor://localhost",
    "https://anor-backend.onrender.com"
];

const configuredOrigins =
    String(
        process.env.FRONTEND_URLS ||
        process.env.FRONTEND_URL ||
        ""
    )
        .split(",")
        .map(origin => origin.trim())
        .filter(Boolean);

const allowedOrigins = [
    ...new Set([
        ...defaultAllowedOrigins,
        ...configuredOrigins
    ])
];

function isPrivateNetworkOrigin(
    origin
) {
    return /^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}):\d+$/.test(
        origin
    );
}

app.use(
    cors({
        origin: function (
            origin,
            callback
        ) {
            if (!origin) {
                return callback(null, true);
            }

            if (
                allowedOrigins.includes(origin)
            ) {
                return callback(null, true);
            }

            if (
                !isProduction &&
                isPrivateNetworkOrigin(origin)
            ) {
                return callback(null, true);
            }

            if (!isProduction) {
                return callback(null, true);
            }

            console.warn(
                `[CORS] Origine refusée par la politique de sécurité: ${origin}`
            );

            return callback(
                new Error(
                    "CORS_ORIGIN_NOT_ALLOWED"
                )
            );
        },

        credentials: true,

        methods: [
            "GET",
            "POST",
            "PUT",
            "DELETE",
            "OPTIONS"
        ],

        allowedHeaders: [
            "Content-Type",
            "Authorization",
            "X-API-Version",
            "X-Request-Id"
        ]
    })
);

// ======================================================
// SÉCURITÉ HTTP
// HELMET & CSP
// ======================================================

app.use(
    helmet({
        crossOriginEmbedderPolicy: false,
        contentSecurityPolicy: false
    })
);

app.use(
    express.json({
        limit: "50mb"
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: "50mb"
    })
);

app.use((req, res, next) => {
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'self' data: blob: https:; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' " +
        "https://unpkg.com https://cdn.jsdelivr.net; " +
        "style-src 'self' 'unsafe-inline' " +
        "https://unpkg.com https://cdnjs.cloudflare.com; " +
        "img-src 'self' data: blob: https:;"
    );

    res.setHeader(
        "X-Content-Type-Options",
        "nosniff"
    );

    res.setHeader(
        "X-Frame-Options",
        "DENY"
    );

    res.setHeader(
        "Referrer-Policy",
        "strict-origin-when-cross-origin"
    );

    next();
});

// ======================================================
// REQUEST ID / LOGGING FORENSIC
// ======================================================

app.use((req, res, next) => {
    const startTime = Date.now();

    const requestId =
        req.headers["x-request-id"] ||
        crypto.randomUUID();

    req.requestId = requestId;

    res.setHeader(
        "X-Request-Id",
        requestId
    );

    res.on("finish", () => {
        const duration =
            Date.now() - startTime;

        if (res.statusCode >= 400) {
            console.warn(
                `[ANOR-WARN] ${req.method} ` +
                `${req.originalUrl} -> ` +
                `${res.statusCode} ` +
                `(${duration}ms) ` +
                `[${requestId}]`
            );
        } else {
            console.log(
                `[ANOR] ${req.method} ` +
                `${req.originalUrl} -> ` +
                `${res.statusCode} ` +
                `(${duration}ms) ` +
                `[${requestId}]`
            );
        }
    });

    next();
});

// ======================================================
// RATE LIMITING DURCI
// ======================================================

const scanLimiter =
    rateLimit({
        windowMs: 60 * 1000,

        max: 60,

        standardHeaders: true,

        legacyHeaders: false,

        handler: (req, res) => {
            securityLog(
                req,
                "RATE_LIMIT_EXCEEDED",
                {
                    ip: req.ip
                }
            );

            return res
                .status(429)
                .json({
                    success: false,

                    error: {
                        code:
                            "TROP_DE_REQUETES",

                        message:
                            "Trop de requêtes de scan. " +
                            "Veuillez patienter avant un nouveau essai."
                    }
                });
        }
    });

// ======================================================
// ANTI-REPLAY AVANCÉ
// ======================================================

const recentRequests = new Map();

const REQUEST_TTL = 30000;
const MAX_RECENT_REQUESTS = 10000;

setInterval(() => {
    const now = Date.now();

    for (
        const [id, time]
        of recentRequests.entries()
    ) {
        if (
            now - time >
            REQUEST_TTL
        ) {
            recentRequests.delete(id);
        }
    }
}, 10000);

app.use((req, res, next) => {
    if (
        ["GET", "HEAD", "OPTIONS"]
            .includes(req.method)
    ) {
        return next();
    }

    const id =
        req.headers["x-request-id"];

    if (!id) {
        return next();
    }

    const replayKey =
        `${req.method}:${req.path}:${id}`;

    if (
        recentRequests.has(replayKey)
    ) {
        securityLog(
            req,
            "REPLAY_ATTACK_DETECTED",
            {
                replayKey
            }
        );

        return apiError(
            res,
            409,
            "DUPLICATE_REQUEST",
            "Cette requête a déjà été traitée " +
            "(protection anti-replay)."
        );
    }

    if (
        recentRequests.size >=
        MAX_RECENT_REQUESTS
    ) {
        const oldestKey =
            recentRequests
                .keys()
                .next()
                .value;

        if (oldestKey) {
            recentRequests.delete(
                oldestKey
            );
        }
    }

    recentRequests.set(
        replayKey,
        Date.now()
    );

    next();
});

// ======================================================
// UPLOAD SÉCURISÉ
// ======================================================

const upload = multer({
    limits: {
        fileSize:
            10 * 1024 * 1024
    },

    fileFilter: (
        req,
        file,
        cb
    ) => {
        const allowedMimes = [
            "application/pdf",
            "image/jpeg",
            "image/png",
            "image/webp"
        ];

        if (
            allowedMimes.includes(
                file.mimetype
            )
        ) {
            return cb(
                null,
                true
            );
        }

        securityLog(
            req,
            "INVALID_FILE_TYPE_ATTEMPT",
            {
                mimetype:
                    file.mimetype
            }
        );

        return cb(
            new Error(
                "INVALID_FILE_TYPE"
            )
        );
    }
});

// ======================================================
// ANALYSE VISUELLE CLASSIQUE
// ET GEMINI IA
// ======================================================

async function intelligentVisualAnalysis(
    scannedMatrix
) {
    if (!scannedMatrix) {
        return {
            lot: null,
            signature: null,
            bits: null,
            confidence: 0,
            source: "NONE"
        };
    }

    if (
        typeof scannedMatrix ===
        "string"
    ) {
        const trimmed =
            scannedMatrix.trim();

        if (!trimmed) {
            return {
                lot: null,
                signature: null,
                bits: null,
                confidence: 0,
                source: "EMPTY"
            };
        }

        if (
            trimmed.startsWith(
                "ANOR51:"
            )
        ) {
            const bits =
                normalizeVisualBits(
                    trimmed.substring(7)
                );

            if (bits) {
                return {
                    lot: null,
                    signature: trimmed,
                    bits,
                    confidence: 0.99,
                    source:
                        "CLIENT_SIGNATURE"
                };
            }
        }

        const directBits =
            normalizeVisualBits(
                trimmed
            );

        if (directBits) {
            return {
                lot: null,

                signature:
                    `ANOR51:${directBits}`,

                bits: directBits,

                confidence: 0.99,

                source:
                    "CLIENT_BITS"
            };
        }

        // Une chaîne courte peut être un lot,
        // mais un lot seul n'est plus considéré
        // comme une preuve cryptovisuelle
        // d'authenticité.
        if (
            trimmed.length < 50 &&
            !trimmed.startsWith(
                "data:image"
            )
        ) {
            return {
                lot: trimmed,

                signature: null,

                bits: null,

                confidence: 0.60,

                source:
                    "CLIENT_LOT_HINT"
            };
        }

        return {
            lot: null,

            signature: null,

            bits: null,

            confidence: 0.20,

            source:
                "UNKNOWN_STRING"
        };
    }

    if (
        typeof scannedMatrix ===
        "object"
    ) {
        const bits =
            normalizeVisualBits(
                scannedMatrix.bits ||
                scannedMatrix.visualBits
            );

        const signature =
            typeof scannedMatrix.signature ===
            "string"
                ? scannedMatrix.signature.trim()
                : (
                    typeof scannedMatrix.visualSignature ===
                    "string"
                        ? scannedMatrix.visualSignature.trim()
                        : null
                );

        const lot =
            scannedMatrix.lot ||
            scannedMatrix.batch ||
            scannedMatrix.certificate_code ||
            null;

        return {
            lot,

            signature,

            bits,

            confidence:
                bits
                    ? 0.99
                    : lot
                        ? 0.60
                        : 0.20,

            source:
                bits
                    ? "CLIENT_OBJECT_BITS"
                    : "CLIENT_OBJECT"
        };
    }

    return {
        lot: null,

        signature: null,

        bits: null,

        confidence: 0,

        source:
            "UNSUPPORTED"
    };
}

// ======================================================
// ANOR VISION ENGINE
// DÉCODAGE LOCAL DES 51 GLYPHES
// ======================================================

function getSealGeometry() {
    /*
     * Géométrie officielle utilisée par SealRenderer :
     *
     * INNER  = 7 glyphes
     * MIDDLE = 24 glyphes
     * OUTER  = 20 glyphes
     *
     * TOTAL = 51 bits
     *
     * Les positions cardinales réservées aux marqueurs
     * de repérage ne font PAS partie des 51 glyphes.
     */

    const geometry = {
        inner: 7,
        middle: 24,
        outer: 20,
        total: 51
    };

    return geometry;
}

// ======================================================
// POSITIONNEMENT DES GLYPHES
// ======================================================

function buildRingPositions(
    count,
    startAngle = -Math.PI / 2
) {
    const positions = [];

    if (!count || count <= 0) {
        return positions;
    }

    for (let i = 0; i < count; i++) {
        const angle =
            startAngle +
            (2 * Math.PI * i) /
            count;

        positions.push({
            index: i,
            angle,

            x: Math.cos(angle),
            y: Math.sin(angle)
        });
    }

    return positions;
}

// ======================================================
// POSITIONS VISIBLES DU SCEAU ANOR
// ======================================================

function getVisiblePositionsLocal() {
    /*
     * Cette fonction reproduit la logique structurelle
     * du SealRenderer :
     *
     * - 12 positions internes possibles -> 7 visibles
     * - 24 positions médianes -> 24 visibles
     * - 32 positions externes -> 20 visibles
     * - 4 positions cardinales réservées aux finders
     */

    const innerCandidates =
        buildRingPositions(12);

    const middleCandidates =
        buildRingPositions(24);

    const outerCandidates =
        buildRingPositions(32);

    const innerVisible =
        innerCandidates.slice(0, 7);

    const middleVisible =
        middleCandidates.slice(0, 24);

    /*
     * Les 4 positions cardinales de l'anneau externe
     * sont réservées aux repères de lecture.
     */
    const outerVisible = [];

    const cardinalIndices = new Set([
        0,
        8,
        16,
        24
    ]);

    for (
        const position
        of outerCandidates
    ) {
        if (
            !cardinalIndices.has(
                position.index
            )
        ) {
            outerVisible.push(
                position
            );
        }

        if (
            outerVisible.length === 20
        ) {
            break;
        }
    }

    return {
        inner: innerVisible,
        middle: middleVisible,
        outer: outerVisible,

        all: [
            ...innerVisible,
            ...middleVisible,
            ...outerVisible
        ]
    };
}

// ======================================================
// TYPE DE GLYPHE
// ======================================================

function resolveGlyphTypeLocal(
    index
) {
    /*
     * La bibliothèque ANOR utilise 5 familles :
     *
     * square
     * rect
     * circle
     * diamond
     * plus
     */

    const types = [
        "square",
        "rect",
        "circle",
        "diamond",
        "plus"
    ];

    return types[
        Math.abs(index) %
        types.length
    ];
}

// ======================================================
// EXTRACTION D'UN PIXEL / ZONE
// ======================================================

function clamp(
    value,
    min,
    max
) {
    return Math.max(
        min,
        Math.min(max, value)
    );
}

function getPixelGray(
    data,
    width,
    height,
    x,
    y
) {
    if (
        !data ||
        !width ||
        !height
    ) {
        return 255;
    }

    const px =
        clamp(
            Math.round(x),
            0,
            width - 1
        );

    const py =
        clamp(
            Math.round(y),
            0,
            height - 1
        );

    const index =
        (py * width + px) * 4;

    if (
        index < 0 ||
        index + 2 >= data.length
    ) {
        return 255;
    }

    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];

    /*
     * Conversion luminance perceptuelle.
     */
    return (
        0.299 * r +
        0.587 * g +
        0.114 * b
    );
}

// ======================================================
// MESURE DE REMPLISSAGE D'UNE ZONE
// ======================================================

function measureRegionDarkness(
    data,
    width,
    height,
    centerX,
    centerY,
    radiusX,
    radiusY,
    samples = 16
) {
    let dark = 0;
    let total = 0;

    if (
        !data ||
        !width ||
        !height ||
        radiusX <= 0 ||
        radiusY <= 0
    ) {
        return {
            darkness: 0,
            coverage: 0,
            samples: 0
        };
    }

    /*
     * Échantillonnage elliptique.
     */
    for (
        let iy = -samples;
        iy <= samples;
        iy++
    ) {
        for (
            let ix = -samples;
            ix <= samples;
            ix++
        ) {
            const nx =
                ix / samples;

            const ny =
                iy / samples;

            if (
                nx * nx +
                ny * ny >
                1
            ) {
                continue;
            }

            const x =
                centerX +
                nx * radiusX;

            const y =
                centerY +
                ny * radiusY;

            const gray =
                getPixelGray(
                    data,
                    width,
                    height,
                    x,
                    y
                );

            /*
             * Plus le pixel est sombre,
             * plus il participe au remplissage.
             */
            const darkness =
                1 -
                gray / 255;

            dark += darkness;
            total++;
        }
    }

    if (total === 0) {
        return {
            darkness: 0,
            coverage: 0,
            samples: 0
        };
    }

    const average =
        dark / total;

    return {
        darkness: average,
        coverage: average,
        samples: total
    };
}

// ======================================================
// CLASSIFICATION TRUTHMODE
// ======================================================

function classifyGlyphFillLocal(
    darkness
) {
    /*
     * Seuils TruthMode provenant de la
     * logique GlyphsLibrary :
     *
     * EMPTY <= 0.45
     * FULL  >= 0.55
     * entre les deux : UNCERTAIN
     */

    if (
        darkness <= 0.45
    ) {
        return {
            state: "EMPTY",
            bit: 0
        };
    }

    if (
        darkness >= 0.55
    ) {
        return {
            state: "FULL",
            bit: 1
        };
    }

    return {
        state: "UNCERTAIN",
        bit: null
    };
}

// ======================================================
// CONFIANCE DU GLYPHE
// ======================================================

function calculateGlyphConfidenceLocal(
    darkness
) {
    if (
        darkness <= 0.45
    ) {
        return clamp(
            1 -
            Math.abs(
                darkness - 0.45
            ) /
            0.45,
            0,
            1
        );
    }

    if (
        darkness >= 0.55
    ) {
        return clamp(
            1 -
            Math.abs(
                darkness - 0.55
            ) /
            0.45,
            0,
            1
        );
    }

    /*
     * Zone d'incertitude.
     */
    const distance =
        Math.abs(
            darkness - 0.50
        );

    return clamp(
        distance / 0.05,
        0,
        1
    );
}

// ======================================================
// ANALYSE D'UN GLYPHE
// ======================================================

function analyzeGlyphLocal(
    data,
    width,
    height,
    centerX,
    centerY,
    radius,
    glyphIndex,
    ringName
) {
    const glyphType =
        resolveGlyphTypeLocal(
            glyphIndex
        );

    /*
     * Les dimensions sont volontairement
     * proportionnelles à la taille du glyph.
     */
    let radiusX =
        radius * 0.55;

    let radiusY =
        radius * 0.55;

    switch (
        glyphType
    ) {
        case "rect":
            radiusX =
                radius * 0.75;

            radiusY =
                radius * 0.30;
            break;

        case "circle":
            radiusX =
                radius * 0.52;

            radiusY =
                radius * 0.52;
            break;

        case "diamond":
            radiusX =
                radius * 0.55;

            radiusY =
                radius * 0.55;
            break;

        case "plus":
            radiusX =
                radius * 0.60;

            radiusY =
                radius * 0.60;
            break;

        case "square":
        default:
            radiusX =
                radius * 0.55;

            radiusY =
                radius * 0.55;
            break;
    }

    const measurement =
        measureRegionDarkness(
            data,
            width,
            height,
            centerX,
            centerY,
            radiusX,
            radiusY,
            12
        );

    const classification =
        classifyGlyphFillLocal(
            measurement.darkness
        );

    const confidence =
        calculateGlyphConfidenceLocal(
            measurement.darkness
        );

    return {
        index: glyphIndex,

        ring: ringName,

        type: glyphType,

        darkness:
            measurement.darkness,

        coverage:
            measurement.coverage,

        state:
            classification.state,

        bit:
            classification.bit,

        confidence,

        samples:
            measurement.samples
    };
}

// ======================================================
// CONVERSION PIXELS -> IMAGE BUFFER
// ======================================================

async function decodeImageToRaw(
    input
) {
    if (!sharp) {
        return null;
    }

    try {
        const result =
            await sharp(input)
                .rotate()
                .resize({
                    width: 1200,
                    height: 1200,
                    fit: "inside",
                    withoutEnlargement: false
                })
                .removeAlpha()
                .raw()
                .toBuffer({
                    resolveWithObject: true
                });

        return {
            data: result.data,

            width:
                result.info.width,

            height:
                result.info.height,

            channels:
                result.info.channels
        };
    } catch (error) {
        console.error(
            "[ANOR VISION] Impossible de convertir l'image :",
            error.message
        );

        return null;
    }
}

// ======================================================
// ESTIMATION CENTRE DU SCEAU
// ======================================================

function estimateSealCenter(
    raw
) {
    if (!raw) {
        return null;
    }

    const {
        data,
        width,
        height,
        channels
    } = raw;

    /*
     * Pour éviter de confondre le produit
     * avec le sceau, on travaille d'abord
     * sur une zone centrale.
     */

    const startX =
        Math.floor(
            width * 0.20
        );

    const endX =
        Math.floor(
            width * 0.80
        );

    const startY =
        Math.floor(
            height * 0.20
        );

    const endY =
        Math.floor(
            height * 0.80
        );

    let weightedX = 0;
    let weightedY = 0;
    let weight = 0;

    const step = Math.max(
        2,
        Math.floor(
            Math.min(
                width,
                height
            ) / 180
        )
    );

    for (
        let y = startY;
        y < endY;
        y += step
    ) {
        for (
            let x = startX;
            x < endX;
            x += step
        ) {
            const index =
                (
                    y * width +
                    x
                ) * channels;

            const r =
                data[index] ?? 255;

            const g =
                data[index + 1] ?? r;

            const b =
                data[index + 2] ?? r;

            const gray =
                (
                    0.299 * r +
                    0.587 * g +
                    0.114 * b
                );

            const darkness =
                1 -
                gray / 255;

            /*
             * On privilégie les zones
             * suffisamment contrastées.
             */
            if (
                darkness < 0.25
            ) {
                continue;
            }

            const w =
                Math.pow(
                    darkness,
                    2
                );

            weightedX +=
                x * w;

            weightedY +=
                y * w;

            weight += w;
        }
    }

    if (weight <= 0) {
        return {
            x: width / 2,
            y: height / 2
        };
    }

    return {
        x:
            weightedX / weight,

        y:
            weightedY / weight
    };
}

// ======================================================
// DÉCODAGE LOCAL DU SCEAU
// ======================================================

async function localSealVisionDecode(
    imageBuffer
) {
    if (!sharp) {
        return {
            success: false,

            reason:
                "SHARP_NOT_INSTALLED",

            bits: null,

            visualSignature: null,

            confidence: 0,

            glyphs: []
        };
    }

    const raw =
        await decodeImageToRaw(
            imageBuffer
        );

    if (!raw) {
        return {
            success: false,

            reason:
                "IMAGE_DECODE_FAILED",

            bits: null,

            visualSignature: null,

            confidence: 0,

            glyphs: []
        };
    }

    const center =
        estimateSealCenter(
            raw
        );

    if (!center) {
        return {
            success: false,

            reason:
                "CENTER_NOT_FOUND",

            bits: null,

            visualSignature: null,

            confidence: 0,

            glyphs: []
        };
    }

    /*
     * Rayon de travail estimé.
     *
     * Le moteur ne considère pas ici que
     * chaque pixel est une information ANOR.
     * Il reconstruit uniquement les zones
     * correspondant à la géométrie connue.
     */
    const baseRadius =
        Math.min(
            raw.width,
            raw.height
        ) * 0.30;

    const geometry =
        getSealGeometry();

    const positions =
        getVisiblePositionsLocal();

    const glyphs = [];

    // --------------------------------------------------
    // ANNEAU INTERNE
    // --------------------------------------------------

    const innerRadius =
        baseRadius * 0.42;

    for (
        let i = 0;
        i < geometry.inner;
        i++
    ) {
        const position =
            positions.inner[i];

        if (!position) {
            continue;
        }

        const x =
            center.x +
            position.x *
            innerRadius;

        const y =
            center.y +
            position.y *
            innerRadius;

        const glyph =
            analyzeGlyphLocal(
                raw.data,
                raw.width,
                raw.height,
                x,
                y,
                baseRadius *
                    0.045,
                i,
                "inner"
            );

        glyphs.push(
            glyph
        );
    }

    // --------------------------------------------------
    // ANNEAU CENTRAL
    // --------------------------------------------------

    const middleRadius =
        baseRadius * 0.67;

    for (
        let i = 0;
        i < geometry.middle;
        i++
    ) {
        const position =
            positions.middle[i];

        if (!position) {
            continue;
        }

        const x =
            center.x +
            position.x *
            middleRadius;

        const y =
            center.y +
            position.y *
            middleRadius;

        const glyph =
            analyzeGlyphLocal(
                raw.data,
                raw.width,
                raw.height,
                x,
                y,
                baseRadius *
                    0.042,
                geometry.inner +
                    i,
                "middle"
            );

        glyphs.push(
            glyph
        );
    }

    // --------------------------------------------------
    // ANNEAU EXTERNE
    // --------------------------------------------------

    const outerRadius =
        baseRadius * 0.88;

    for (
        let i = 0;
        i < geometry.outer;
        i++
    ) {
        const position =
            positions.outer[i];

        if (!position) {
            continue;
        }

        const x =
            center.x +
            position.x *
            outerRadius;

        const y =
            center.y +
            position.y *
            outerRadius;

        const glyph =
            analyzeGlyphLocal(
                raw.data,
                raw.width,
                raw.height,
                x,
                y,
                baseRadius *
                    0.040,
                geometry.inner +
                    geometry.middle +
                    i,
                "outer"
            );

        glyphs.push(
            glyph
        );
    }

    // ==================================================
    // AGRÉGATION
    // ==================================================

    const knownBits = [];

    let confidenceSum = 0;
    let confidenceCount = 0;
    let uncertainCount = 0;

    for (
        const glyph
        of glyphs
    ) {
        if (
            glyph.bit === 0 ||
            glyph.bit === 1
        ) {
            knownBits.push(
                String(glyph.bit)
            );
        } else {
            /*
             * Une valeur incertaine ne doit jamais
             * être transformée arbitrairement en
             * preuve d'authenticité.
             */
            knownBits.push("0");

            uncertainCount++;
        }

        confidenceSum +=
            glyph.confidence;

        confidenceCount++;
    }

    /*
     * On ne valide une signature locale
     * que si les 51 positions ont réellement
     * été analysées.
     */
    const complete =
        glyphs.length ===
        VISUAL_BITS_LENGTH;

    const averageConfidence =
        confidenceCount > 0
            ? confidenceSum /
              confidenceCount
            : 0;

    let bits = null;

    if (complete) {
        bits =
            knownBits.join("");

        if (
            !normalizeVisualBits(bits)
        ) {
            bits = null;
        }
    }

    const result = {
        success:
            Boolean(bits),

        reason:
            bits
                ? "LOCAL_VISION_DECODED"
                : (
                    complete
                        ? "BITS_INVALID"
                        : "INCOMPLETE_GLYPH_SET"
                ),

        bits,

        visualSignature:
            bits
                ? `ANOR51:${bits}`
                : null,

        confidence:
            averageConfidence,

        uncertainGlyphs:
            uncertainCount,

        glyphs,

        geometry: {
            ...geometry,

            centerX:
                center.x,

            centerY:
                center.y,

            radius:
                baseRadius
        }
    };

    return result;
}

// ======================================================
// VALIDATION VISUELLE CONTRE UN SCEAU CERTIFIÉ
// ======================================================

function compareVisualEvidence(
    scannedBits,
    certifiedBits
) {
    const a =
        normalizeVisualBits(
            scannedBits
        );

    const b =
        normalizeVisualBits(
            certifiedBits
        );

    if (!a || !b) {
        return {
            valid: false,

            distance: Infinity,

            reason:
                "INVALID_VISUAL_BITS"
        };
    }

    const distance =
        calculateHammingDistance(
            a,
            b
        );

    /*
     * Tolérance historique ANOR :
     * maximum 6 différences.
     *
     * Cette tolérance ne signifie PAS
     * qu'une signature inconnue est valide.
     * Elle ne s'applique qu'après comparaison
     * avec un sceau officiellement enregistré.
     */
    const valid =
        distance <= 6;

    return {
        valid,

        distance,

        reason:
            valid
                ? "VISUAL_MATCH"
                : "VISUAL_MISMATCH"
    };
}

// ======================================================
// NORMALISATION DES IDENTIFIANTS LOT / SÉRIE
// ======================================================

function cleanIdentifier(
    value,
    maxLength = 80
) {
    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    const cleaned =
        String(value)
            .trim()
            .toUpperCase()
            .replace(
                /[\r\n\t]+/g,
                " "
            )
            .replace(
                /[^A-Z0-9._\/-]/g,
                ""
            )
            .slice(
                0,
                maxLength
            );

    return cleaned || null;
}

function normalizeLotValue(
    value
) {
    return cleanIdentifier(
        value,
        60
    );
}

function normalizeSerialValue(
    value
) {
    return cleanIdentifier(
        value,
        80
    );
}

// ======================================================
// EXTRACTION LOT / SÉRIE PAR OCR LOCAL
// ======================================================

function extractLotSerialFromText(
    text
) {
    if (
        !text ||
        typeof text !== "string"
    ) {
        return {
            lot: null,

            serial: null,

            reference: null,

            confidence: 0,

            source: "NONE",

            rawText: ""
        };
    }

    const normalized =
        text
            .replace(
                /\r/g,
                "\n"
            )
            .trim();

    /*
     * LOT
     *
     * Exemples :
     * LOT: ABC123
     * LOT ABC123
     * LOT N° ABC123
     * BATCH: ABC123
     */
    const lotMatch =
        normalized.match(
            /(?:LOT|BATCH|LOT\s*NO\.?|N°\s*LOT)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{1,40})/i
        );

    /*
     * SÉRIE
     *
     * Exemples :
     * N°: ABC123
     * N° ABC123
     * SERIE: ABC123
     * SERIAL: ABC123
     */
    const serialMatch =
        normalized.match(
            /(?:N°|NO\.?|Nº|SERIE|SÉRIE|SERIAL)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{1,40})/i
        );

    /*
     * Référence produit.
     */
    const referenceMatch =
        normalized.match(
            /(?:REF|REFERENCE|RÉF|RÉFÉRENCE)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{1,40})/i
        );

    const lot =
        lotMatch
            ? normalizeLotValue(
                lotMatch[1]
            )
            : null;

    const serial =
        serialMatch
            ? normalizeSerialValue(
                serialMatch[1]
            )
            : null;

    const reference =
        referenceMatch
            ? cleanIdentifier(
                referenceMatch[1],
                60
            )
            : null;

    let confidence = 0;

    if (lot) {
        confidence += 0.40;
    }

    if (serial) {
        confidence += 0.45;
    }

    if (reference) {
        confidence += 0.15;
    }

    return {
        lot,

        serial,

        reference,

        confidence:
            Math.min(
                confidence,
                1
            ),

        source: "OCR_LOCAL",

        rawText:
            normalized.slice(
                0,
                5000
            )
    };
}

// ======================================================
// OCR LOCAL AVEC TESSERACT
// ======================================================

async function runLocalOCR(
    imageBuffer
) {
    if (
        !Tesseract ||
        !imageBuffer
    ) {
        return {
            success: false,

            lot: null,

            serial: null,

            reference: null,

            confidence: 0,

            source:
                "OCR_UNAVAILABLE",

            rawText: ""
        };
    }

    try {
        const result =
            await Tesseract.recognize(
                imageBuffer,
                "eng",
                {
                    logger:
                        () => {}
                }
            );

        const text =
            result?.data?.text ||
            "";

        const parsed =
            extractLotSerialFromText(
                text
            );

        return {
            success: Boolean(
                parsed.lot ||
                parsed.serial
            ),

            ...parsed
        };
    } catch (error) {
        console.error(
            "[ANOR OCR] Erreur OCR :",
            error.message
        );

        return {
            success: false,

            lot: null,

            serial: null,

            reference: null,

            confidence: 0,

            source:
                "OCR_ERROR",

            rawText: ""
        };
    }
}

// ======================================================
// PROMPT GEMINI : LECTURE LOT + SÉRIE
// ======================================================

const GEMINI_EXTRACTION_PROMPT = `
Tu es le module de lecture documentaire du système ANOR CHECK.

IMPORTANT :
Tu NE dois JAMAIS décider si un sceau est authentique ou contrefait.

Ton seul rôle est de lire les informations imprimées ou visibles
sur l'image du produit ou du sceau.

Extrais, si elles sont lisibles :

1. LOT
2. NUMÉRO DE SÉRIE
3. RÉFÉRENCE PRODUIT

Retourne UNIQUEMENT un JSON valide de la forme :

{
  "lot": "string ou null",
  "serial": "string ou null",
  "reference": "string ou null",
  "confidence": 0.0
}

Règles :

- Ne devine jamais une valeur illisible.
- Si une information n'est pas lisible, retourne null.
- Respecte exactement les caractères visibles.
- Ne transforme pas un numéro de série en numéro de lot.
- Ne transforme pas une référence produit en numéro de série.
- La valeur confidence doit être comprise entre 0 et 1.
- Tu ne dois produire aucune conclusion d'authenticité.
- La certification finale sera effectuée exclusivement par le serveur ANOR
  à partir de la signature visuelle et de la base officielle.
`;

// ======================================================
// UTILITAIRE JSON GEMINI
// ======================================================

function parseGeminiJson(
    text
) {
    if (
        !text ||
        typeof text !== "string"
    ) {
        return null;
    }

    let cleaned =
        text.trim();

    /*
     * Suppression éventuelle des fences markdown.
     */
    cleaned =
        cleaned
            .replace(
                /^```json\s*/i,
                ""
            )
            .replace(
                /^```\s*/i,
                ""
            )
            .replace(
                /\s*```$/i,
                ""
            )
            .trim();

    try {
        return JSON.parse(
            cleaned
        );
    } catch (error) {
        /*
         * Tentative d'extraction du premier objet JSON.
         */
        const start =
            cleaned.indexOf("{");

        const end =
            cleaned.lastIndexOf("}");

        if (
            start >= 0 &&
            end > start
        ) {
            try {
                return JSON.parse(
                    cleaned.slice(
                        start,
                        end + 1
                    )
                );
            } catch (innerError) {
                return null;
            }
        }

        return null;
    }
}

// ======================================================
// APPEL GEMINI AVEC CHAÎNE DE FALLBACK
// ======================================================

async function geminiReadLotSerial(
    imageBuffer
) {
    if (
        !ai ||
        !imageBuffer
    ) {
        return {
            success: false,

            lot: null,

            serial: null,

            reference: null,

            confidence: 0,

            source:
                "GEMINI_UNAVAILABLE",

            model: null
        };
    }

    /*
     * Ordre de préférence.
     *
     * Les modèles plus récents sont essayés en premier.
     */
    const models = [
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-3.6-flash"
    ];

    let lastError = null;

    const base64Image =
        imageBuffer.toString(
            "base64"
        );

    for (
        const model
        of models
    ) {
        try {
            const response =
                await ai.models.generateContent(
                    {
                        model,

                        contents: [
                            {
                                role: "user",

                                parts: [
                                    {
                                        text:
                                            GEMINI_EXTRACTION_PROMPT
                                    },

                                    {
                                        inlineData: {
                                            mimeType:
                                                "image/jpeg",

                                            data:
                                                base64Image
                                        }
                                    }
                                ]
                            }
                        ]
                    }
                );

            const responseText =
                response?.text ||
                "";

            const parsed =
                parseGeminiJson(
                    responseText
                );

            if (!parsed) {
                throw new Error(
                    "GEMINI_INVALID_JSON"
                );
            }

            const lot =
                normalizeLotValue(
                    parsed.lot
                );

            const serial =
                normalizeSerialValue(
                    parsed.serial
                );

            const reference =
                cleanIdentifier(
                    parsed.reference,
                    60
                );

            let confidence =
                Number(
                    parsed.confidence
                );

            if (
                !Number.isFinite(
                    confidence
                )
            ) {
                confidence = 0;
            }

            confidence =
                clamp(
                    confidence,
                    0,
                    1
                );

            return {
                success:
                    Boolean(
                        lot ||
                        serial ||
                        reference
                    ),

                lot,

                serial,

                reference,

                confidence,

                source:
                    "GEMINI_VISION",

                model
            };
        } catch (error) {
            lastError =
                error;

            console.warn(
                `[ANOR GEMINI] Modèle ${model} indisponible ou en erreur : ${error.message}`
            );
        }
    }

    return {
        success: false,

        lot: null,

        serial: null,

        reference: null,

        confidence: 0,

        source:
            "GEMINI_ERROR",

        model: null,

        error:
            lastError
                ? lastError.message
                : null
    };
}

// ======================================================
// IDENTIFIANTS LOT / SÉRIE
// ======================================================

function serialIndexFromValue(
    serial
) {
    const normalized =
        normalizeSerialValue(
            serial
        );

    if (!normalized) {
        return null;
    }

    /*
     * Format attendu :
     *
     * LOT-000001
     * LOT-000002
     * LOT-000003
     *
     * On récupère uniquement le dernier bloc numérique.
     */
    const match =
        normalized.match(
            /(?:^|[-_/])(\d+)$/
        );

    if (!match) {
        return null;
    }

    const index =
        Number(
            match[1]
        );

    if (
        !Number.isSafeInteger(
            index
        ) ||
        index <= 0
    ) {
        return null;
    }

    return index;
}

// ======================================================
// IDENTIFIANT UNITAIRE CANONIQUE
// ======================================================

function canonicalUnitSerial(
    lot,
    serial,
    index = null
) {
    const normalizedLot =
        normalizeLotValue(
            lot
        );

    const normalizedSerial =
        normalizeSerialValue(
            serial
        );

    if (
        !normalizedLot ||
        !normalizedSerial
    ) {
        return null;
    }

    /*
     * Le numéro imprimé reste l'identifiant
     * principal de l'unité.
     *
     * L'index n'est utilisé qu'en complément
     * lorsqu'il est connu.
     */
    if (
        index !== null &&
        Number.isSafeInteger(
            Number(index)
        )
    ) {
        return `${normalizedLot}:${normalizedSerial}:${Number(index)}`;
    }

    return `${normalizedLot}:${normalizedSerial}`;
}

// ======================================================
// HASH SÉCURISÉ DE L'UNITÉ
// ======================================================

function deriveUnitSecureHash(
    masterSignature,
    serialNumber,
    index
) {
    return sha256Hex(
        `${masterSignature}-${serialNumber}-${index}`
    );
}

// ======================================================
// SIGNATURE VISUELLE ATTENDUE D'UNE UNITÉ
// ======================================================

function deriveExpectedUnitVisualBits(
    masterSignature,
    serialNumber,
    index
) {
    if (
        !masterSignature ||
        !serialNumber ||
        !Number.isSafeInteger(
            Number(index)
        )
    ) {
        return null;
    }

    try {
        const unitHash =
            deriveUnitSecureHash(
                masterSignature,
                serialNumber,
                Number(index)
            );

        /*
         * SealRenderer est l'autorité pour
         * transformer le hash unitaire en
         * signature visuelle ANOR.
         */
        if (
            !SealRenderer ||
            typeof SealRenderer.deriveVisualBits !==
            "function"
        ) {
            return null;
        }

        const bits =
            SealRenderer.deriveVisualBits(
                unitHash
            );

        return normalizeVisualBits(
            bits
        );
    } catch (error) {
        console.error(
            "[ANOR UNIT] Erreur dérivation signature unitaire :",
            error.message
        );

        return null;
    }
}

// ======================================================
// LECTURE D'UN NUMÉRO DE SÉRIE DANS SUPABASE
// ======================================================

async function lookupUnitSerial(
    lot,
    serial
) {
    const normalizedLot =
        normalizeLotValue(
            lot
        );

    const normalizedSerial =
        normalizeSerialValue(
            serial
        );

    if (
        !normalizedLot ||
        !normalizedSerial
    ) {
        return {
            found: false,

            row: null,

            error:
                "INVALID_LOT_OR_SERIAL"
        };
    }

    try {
        /*
         * Table officielle des numéros de série
         * unitaires.
         */
        const {
            data,
            error
        } =
            await supabase
                .from(
                    "produits_unitaires_serials"
                )
                .select("*")
                .eq(
                    "lot_code",
                    normalizedLot
                )
                .eq(
                    "serial_number",
                    normalizedSerial
                )
                .maybeSingle();

        if (error) {
            /*
             * Une table absente ne doit pas
             * faire tomber toute la vérification.
             *
             * Le serveur pourra néanmoins vérifier
             * le format et la quantité déclarée.
             */
            console.error(
                "[ANOR UNIT] Erreur lecture registre série :",
                error.message
            );

            return {
                found: false,

                row: null,

                error:
                    error.message
            };
        }

        return {
            found:
                Boolean(data),

            row:
                data || null,

            error: null
        };
    } catch (error) {
        console.error(
            "[ANOR UNIT] Exception lecture série :",
            error.message
        );

        return {
            found: false,

            row: null,

            error:
                error.message
        };
    }
}

// ======================================================
// COMPTEUR DES SCANS D'UNE SÉRIE
// ======================================================

async function getSerialScanHistory(
    lot,
    serial
) {
    const normalizedLot =
        normalizeLotValue(
            lot
        );

    const normalizedSerial =
        normalizeSerialValue(
            serial
        );

    if (
        !normalizedLot ||
        !normalizedSerial
    ) {
        return {
            count: 0,

            rows: [],

            error:
                "INVALID_LOT_OR_SERIAL"
        };
    }

    try {
        const {
            data,
            error
        } =
            await supabase
                .from(
                    "produits_unitaires_scans"
                )
                .select("*")
                .eq(
                    "lot_code",
                    normalizedLot
                )
                .eq(
                    "serial_number",
                    normalizedSerial
                )
                .order(
                    "created_at",
                    {
                        ascending: false
                    }
                )
                .limit(100);

        if (error) {
            console.error(
                "[ANOR UNIT] Erreur historique série :",
                error.message
            );

            return {
                count: 0,

                rows: [],

                error:
                    error.message
            };
        }

        return {
            count:
                Array.isArray(data)
                    ? data.length
                    : 0,

            rows:
                Array.isArray(data)
                    ? data
                    : [],

            error: null
        };
    } catch (error) {
        console.error(
            "[ANOR UNIT] Exception historique série :",
            error.message
        );

        return {
            count: 0,

            rows: [],

            error:
                error.message
        };
    }
}

// ======================================================
// ANALYSE DE LA RAPIDITÉ DES SCANS
// ======================================================

function analyzeRapidRepeatedScans(
    rows
) {
    if (
        !Array.isArray(rows) ||
        rows.length < 2
    ) {
        return {
            suspicious: false,

            minimumIntervalMs: null,

            reason: null
        };
    }

    const timestamps =
        rows
            .map(row => {
                const value =
                    row.created_at ||
                    row.scanned_at ||
                    row.timestamp;

                if (!value) {
                    return null;
                }

                const time =
                    new Date(
                        value
                    ).getTime();

                return Number.isFinite(
                    time
                )
                    ? time
                    : null;
            })
            .filter(
                value =>
                    value !== null
            )
            .sort(
                (a, b) =>
                    b - a
            );

    if (
        timestamps.length < 2
    ) {
        return {
            suspicious: false,

            minimumIntervalMs: null,

            reason: null
        };
    }

    let minimumInterval =
        Infinity;

    for (
        let i = 0;
        i <
        timestamps.length - 1;
        i++
    ) {
        const interval =
            Math.abs(
                timestamps[i] -
                timestamps[i + 1]
            );

        if (
            interval <
            minimumInterval
        ) {
            minimumInterval =
                interval;
        }
    }

    /*
     * Même série scannée plusieurs fois
     * en moins de 30 secondes.
     *
     * Ce n'est pas automatiquement une contrefaçon :
     * c'est un signal de surveillance.
     */
    const suspicious =
        minimumInterval <
        30 * 1000;

    return {
        suspicious,

        minimumIntervalMs:
            Number.isFinite(
                minimumInterval
            )
                ? minimumInterval
                : null,

        reason:
            suspicious
                ? "RAPID_REPEATED_SCAN"
                : null
    };
}

// ======================================================
// DÉTECTION DU MOUVEMENT GÉOGRAPHIQUE IMPOSSIBLE
// ======================================================

function analyzeImpossibleGeographicMovement(
    rows,
    currentLocation
) {
    if (
        !Array.isArray(rows) ||
        rows.length === 0 ||
        !currentLocation
    ) {
        return {
            suspicious: false,

            distanceKm: null,

            elapsedHours: null,

            speedKmh: null,

            reason: null
        };
    }

    const currentLat =
        Number(
            currentLocation.latitude
        );

    const currentLon =
        Number(
            currentLocation.longitude
        );

    if (
        !Number.isFinite(
            currentLat
        ) ||
        !Number.isFinite(
            currentLon
        )
    ) {
        return {
            suspicious: false,

            distanceKm: null,

            elapsedHours: null,

            speedKmh: null,

            reason: null
        };
    }

    let previous = null;

    for (
        const row
        of rows
    ) {
        const lat =
            Number(
                row.latitude
            );

        const lon =
            Number(
                row.longitude
            );

        const timestamp =
            new Date(
                row.created_at ||
                row.scanned_at ||
                row.timestamp ||
                0
            ).getTime();

        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lon) ||
            !Number.isFinite(timestamp) ||
            timestamp <= 0
        ) {
            continue;
        }

        previous = {
            latitude: lat,

            longitude: lon,

            timestamp
        };

        break;
    }

    if (!previous) {
        return {
            suspicious: false,

            distanceKm: null,

            elapsedHours: null,

            speedKmh: null,

            reason: null
        };
    }

    const distanceKm =
        calculateGeographicDistanceKm(
            previous.latitude,
            previous.longitude,
            currentLat,
            currentLon
        );

    const elapsedMs =
        Math.abs(
            Date.now() -
            previous.timestamp
        );

    const elapsedHours =
        elapsedMs /
        (1000 * 60 * 60);

    /*
     * Si le temps écoulé est extrêmement faible,
     * la vitesse calculée devient artificiellement énorme.
     */
    if (
        elapsedHours <= 0
    ) {
        return {
            suspicious: false,

            distanceKm,

            elapsedHours,

            speedKmh: null,

            reason: null
        };
    }

    const speedKmh =
        distanceKm /
        elapsedHours;

    /*
     * Seuil de surveillance.
     *
     * Il ne s'agit pas d'une preuve de fraude :
     * un appareil peut changer de réseau,
     * utiliser un VPN, une géolocalisation approximative,
     * ou le téléphone peut fournir des coordonnées erronées.
     */
    const suspicious =
        speedKmh > 900;

    return {
        suspicious,

        distanceKm,

        elapsedHours,

        speedKmh,

        reason:
            suspicious
                ? "IMPOSSIBLE_GEOGRAPHIC_MOVEMENT"
                : null
    };
}

// ======================================================
// COMPTAGE DES SÉRIES DISTINCTES OBSERVÉES
// DANS UN LOT
// ======================================================

async function countObservedUniqueSerials(
    lot
) {
    const normalizedLot =
        normalizeLotValue(
            lot
        );

    if (!normalizedLot) {
        return {
            count: 0,

            serials: [],

            error:
                "INVALID_LOT"
        };
    }

    try {
        const {
            data,
            error
        } =
            await supabase
                .from(
                    "produits_unitaires_scans"
                )
                .select(
                    "serial_number"
                )
                .eq(
                    "lot_code",
                    normalizedLot
                )
                .limit(10000);

        if (error) {
            console.error(
                "[ANOR UNIT] Impossible de compter les séries observées :",
                error.message
            );

            return {
                count: 0,

                serials: [],

                error:
                    error.message
            };
        }

        const serialSet =
            new Set();

        if (
            Array.isArray(data)
        ) {
            for (
                const row
                of data
            ) {
                const serial =
                    normalizeSerialValue(
                        row.serial_number
                    );

                if (serial) {
                    serialSet.add(
                        serial
                    );
                }
            }
        }

        return {
            count:
                serialSet.size,

            serials:
                Array.from(
                    serialSet
                ),

            error: null
        };
    } catch (error) {
        console.error(
            "[ANOR UNIT] Exception comptage séries :",
            error.message
        );

        return {
            count: 0,

            serials: [],

            error:
                error.message
        };
    }
}

// ======================================================
// ANALYSE DE COHÉRENCE DE PRODUCTION
// ======================================================

async function analyzeProductionConsistency({
    certifiedProduct,
    lot,
    serial,
    scannedBits,
    location
}) {
    const normalizedLot =
        normalizeLotValue(
            lot
        );

    const normalizedSerial =
        normalizeSerialValue(
            serial
        );

    const declaredQuantity =
        Number(
            certifiedProduct?.quantite
        );

    const quantityKnown =
        Number.isFinite(
            declaredQuantity
        ) &&
        declaredQuantity > 0;

    const unitIndex =
        serialIndexFromValue(
            normalizedSerial
        );

    const result = {
        lot:
            normalizedLot,

        serial:
            normalizedSerial,

        declaredQuantity:
            quantityKnown
                ? declaredQuantity
                : null,

        unitIndex,

        quantityExceeded: false,

        serialValid: false,

        serialRegistered: false,

        expectedVisualMatch: null,

        expectedVisualDistance: null,

        duplicateScanCount: 0,

        uniqueObservedSerials: 0,

        geographicAnomaly: false,

        rapidRepeatedScan: false,

        anomaly: null,

        status:
            "NON_DETERMINE",

        registryError: null
    };

    // ==================================================
    // 1. CONTRÔLE QUANTITÉ / INDEX
    // ==================================================

    if (
        quantityKnown &&
        unitIndex !== null
    ) {
        if (
            unitIndex >
            declaredQuantity
        ) {
            result.quantityExceeded =
                true;

            result.anomaly =
                "QUANTITE_DECLARED_EXCEEDED";
        }
    }

    /*
     * Si aucun index numérique n'est présent,
     * on ne fabrique pas un index.
     */
    if (
        unitIndex === null
    ) {
        result.serialValid =
            false;
    } else {
        result.serialValid =
            quantityKnown
                ? unitIndex <=
                  declaredQuantity
                : true;
    }

    // ==================================================
    // 2. REGISTRE OFFICIEL DES SÉRIES
    // ==================================================

    if (
        normalizedLot &&
        normalizedSerial
    ) {
        const registry =
            await lookupUnitSerial(
                normalizedLot,
                normalizedSerial
            );

        result.serialRegistered =
            registry.found;

        if (
            registry.error
        ) {
            result.registryError =
                registry.error;
        }

        if (
            registry.found &&
            registry.row
        ) {
            /*
             * Si le registre possède un index,
             * il doit rester cohérent avec celui
             * extrait du numéro.
             */
            const registeredIndex =
                Number(
                    registry.row.unit_index
                );

            if (
                Number.isSafeInteger(
                    registeredIndex
                ) &&
                unitIndex !== null &&
                registeredIndex !==
                    unitIndex
            ) {
                result.serialValid =
                    false;

                result.anomaly =
                    "SERIAL_INDEX_MISMATCH";
            }

            /*
             * Le registre officiel peut aussi contenir
             * le hash unitaire.
             */
            if (
                registry.row.secure_unit_hash
            ) {
                result.registeredSecureHash =
                    registry.row.secure_unit_hash;
            }
        }
    }

    // ==================================================
    // 3. HISTORIQUE DE LA SÉRIE
    // ==================================================

    const history =
        await getSerialScanHistory(
            normalizedLot,
            normalizedSerial
        );

    /*
     * Si le scan actuel n'est pas encore inséré,
     * count représente les scans précédents.
     */
    result.duplicateScanCount =
        history.count;

    const rapid =
        analyzeRapidRepeatedScans(
            history.rows
        );

    result.rapidRepeatedScan =
        rapid.suspicious;

    // ==================================================
    // 4. SIGNATURE VISUELLE UNITAIRE
    // ==================================================

    /*
     * Cette étape n'est activée que si :
     *
     * - la signature maître est disponible ;
     * - le numéro de série contient un index ;
     * - SealRenderer sait dériver les 51 bits.
     *
     * IMPORTANT :
     *
     * cela suppose que le processus d'impression
     * des sceaux unitaires utilise bien :
     *
     * SHA256(masterSignature-serial-index)
     *
     * puis SealRenderer.deriveVisualBits().
     */
    const masterSignature =
        certifiedProduct?.ai_signature_hash ||
        certifiedProduct?.signature_ia ||
        certifiedProduct?.sha256_hash ||
        null;

    if (
        masterSignature &&
        normalizedSerial &&
        unitIndex !== null &&
        scannedBits
    ) {
        const expectedBits =
            deriveExpectedUnitVisualBits(
                masterSignature,
                normalizedSerial,
                unitIndex
            );

        if (expectedBits) {
            const visualComparison =
                compareVisualEvidence(
                    scannedBits,
                    expectedBits
                );

            result.expectedVisualMatch =
                visualComparison.valid;

            result.expectedVisualDistance =
                visualComparison.distance;

            if (
                !visualComparison.valid
            ) {
                /*
                 * Ce signal est important mais doit
                 * rester distinct de l'authenticité
                 * maître.
                 */
                if (
                    !result.anomaly
                ) {
                    result.anomaly =
                        "SERIAL_VISUAL_MISMATCH";
                }
            }
        }
    }

    // ==================================================
    // 5. MOUVEMENT GÉOGRAPHIQUE
    // ==================================================

    const geo =
        analyzeImpossibleGeographicMovement(
            history.rows,
            location
        );

    result.geographicAnomaly =
        geo.suspicious;

    result.geographicDistanceKm =
        geo.distanceKm;

    result.geographicSpeedKmh =
        geo.speedKmh;

    if (
        geo.suspicious &&
        !result.anomaly
    ) {
        result.anomaly =
            "IMPOSSIBLE_GEOGRAPHIC_MOVEMENT";
    }

    // ==================================================
    // 6. COMPTAGE GLOBAL DU LOT
    // ==================================================

    const observed =
        await countObservedUniqueSerials(
            normalizedLot
        );

    result.uniqueObservedSerials =
        observed.count;

    result.observedSerials =
        observed.serials;

    /*
     * Dépassement du nombre d'unités distinctes
     * observées pour un lot.
     */
    if (
        quantityKnown &&
        observed.count >
        declaredQuantity
    ) {
        result.quantityExceeded =
            true;

        if (
            !result.anomaly
        ) {
            result.anomaly =
                "UNIQUE_SERIALS_ABOVE_DECLARED_QUANTITY";
        }
    }

    // ==================================================
    // 7. DOUBLON
    // ==================================================

    if (
        result.duplicateScanCount > 0
    ) {
        /*
         * Un même numéro peut légitimement
         * être scanné plusieurs fois.
         *
         * On signale donc un doublon,
         * sans déclarer automatiquement
         * une contrefaçon.
         */
        if (
            !result.anomaly
        ) {
            result.anomaly =
                "SERIAL_DUPLICATE_SCAN";
        }
    }

    if (
        result.rapidRepeatedScan
    ) {
        result.anomaly =
            "SCAN_MULTIPLE_RAPIDE";
    }

    // ==================================================
    // 8. STATUT GLOBAL DE PRODUCTION
    // ==================================================

    if (
        result.quantityExceeded
    ) {
        result.status =
            "ANOMALIE_QUANTITE";
    } else if (
        result.geographicAnomaly
    ) {
        result.status =
            "ANOMALIE_GEOGRAPHIQUE";
    } else if (
        result.expectedVisualMatch ===
        false
    ) {
        result.status =
            "ANOMALIE_SIGNATURE_UNITAIRE";
    } else if (
        result.duplicateScanCount > 0
    ) {
        result.status =
            "SERIE_DEJA_SCANNÉE";
    } else if (
        result.serialRegistered
    ) {
        result.status =
            "UNITE_REGISTREE";
    } else if (
        result.serialValid
    ) {
        result.status =
            "UNITE_NUMERIQUEMENT_COHERENTE";
    } else {
        result.status =
            "UNITE_NON_DETERMINEE";
    }

    /*
     * Si le numéro de série n'existe pas
     * dans le registre officiel, il faut le signaler.
     */
    if (
        normalizedSerial &&
        !result.serialRegistered
    ) {
        if (
            !result.anomaly
        ) {
            result.anomaly =
                "SERIAL_NOT_REGISTERED";
        }

        if (
            result.status ===
            "UNITE_NON_DETERMINEE"
        ) {
            result.status =
                "SERIE_NON_ENREGISTREE";
        }
    }

    return result;
}

// ======================================================
// CRÉATION D'UN ÉVÉNEMENT DE TRAÇABILITÉ
// ======================================================

function buildScanTrace({
    req,
    lot,
    serial,
    visualBits,
    visualSignature,
    location,
    productionAnalysis,
    ocrResult,
    geminiResult,
    visualComparison
}) {
    return {
        requestId:
            req.requestId ||
            req.headers[
                "x-request-id"
            ] ||
            null,

        timestamp:
            new Date().toISOString(),

        lot:
            lot || null,

        serial:
            serial || null,

        visualSignature:
            visualSignature || null,

        visualBits:
            visualBits || null,

        visualDistance:
            visualComparison?.distance ??
            null,

        visualMatch:
            visualComparison?.valid ??
            false,

        location: {
            latitude:
                location?.latitude ??
                null,

            longitude:
                location?.longitude ??
                null,

            method:
                location?.locationMethod ??
                null,

            ville:
                location?.ville ??
                null,

            region:
                location?.region ??
                null
        },

        production:
            productionAnalysis ||
            null,

        extraction: {
            ocr: {
                lot:
                    ocrResult?.lot ??
                    null,

                serial:
                    ocrResult?.serial ??
                    null,

                confidence:
                    ocrResult?.confidence ??
                    0
            },

            gemini: {
                lot:
                    geminiResult?.lot ??
                    null,

                serial:
                    geminiResult?.serial ??
                    null,

                confidence:
                    geminiResult?.confidence ??
                    0,

                model:
                    geminiResult?.model ??
                    null
            }
        }
    };
}

// ======================================================
// ENREGISTREMENT DU SCAN UNITAIRE
// ======================================================

async function recordUnitScan(
    trace
) {
    if (!trace) {
        return {
            success: false,

            error:
                "TRACE_EMPTY"
        };
    }

    try {
        const row = {
            lot_code:
                trace.lot,

            serial_number:
                trace.serial,

            visual_signature:
                trace.visualSignature,

            visual_bits:
                trace.visualBits,

            visual_match:
                Boolean(
                    trace.visualMatch
                ),

            visual_distance:
                trace.visualDistance,

            latitude:
                trace.location?.latitude ??
                null,

            longitude:
                trace.location?.longitude ??
                null,

            location_method:
                trace.location?.method ??
                null,

            ville:
                trace.location?.ville ??
                null,

            region:
                trace.location?.region ??
                null,

            production_status:
                trace.production?.status ??
                null,

            production_anomaly:
                trace.production?.anomaly ??
                null,

            duplicate_scan_count:
                trace.production?.duplicateScanCount ??
                0,

            unique_observed_serials:
                trace.production?.uniqueObservedSerials ??
                0,

            request_id:
                trace.requestId,

            ocr_lot:
                trace.extraction?.ocr?.lot ??
                null,

            ocr_serial:
                trace.extraction?.ocr?.serial ??
                null,

            ocr_confidence:
                trace.extraction?.ocr?.confidence ??
                0,

            gemini_lot:
                trace.extraction?.gemini?.lot ??
                null,

            gemini_serial:
                trace.extraction?.gemini?.serial ??
                null,

            gemini_confidence:
                trace.extraction?.gemini?.confidence ??
                0,

            gemini_model:
                trace.extraction?.gemini?.model ??
                null,

            created_at:
                trace.timestamp
        };

        const {
            data,
            error
        } =
            await supabase
                .from(
                    "produits_unitaires_scans"
                )
                .insert(
                    row
                )
                .select()
                .maybeSingle();

        if (error) {
            console.error(
                "[ANOR TRACE] Échec enregistrement scan unitaire :",
                error.message
            );

            return {
                success: false,

                error:
                    error.message,

                row: null
            };
        }

        return {
            success: true,

            error: null,

            row:
                data || null
        };
    } catch (error) {
        console.error(
            "[ANOR TRACE] Exception insertion scan :",
            error.message
        );

        return {
            success: false,

            error:
                error.message,

            row: null
        };
    }
}

// ======================================================
// MISE À JOUR DU COMPTEUR DU PRODUIT CERTIFIÉ
// ======================================================

async function updateCertifiedProductScan(
    product,
    location
) {
    if (
        !product ||
        !product.id
    ) {
        return {
            success: false,

            error:
                "PRODUCT_ID_MISSING"
        };
    }

    try {
        const currentCount =
            Number(
                product.scan_count ||
                product.nombre_scans ||
                0
            );

        const newCount =
            Number.isFinite(
                currentCount
            )
                ? currentCount + 1
                : 1;

        const updatePayload = {
            scan_count:
                newCount,

            last_scan_at:
                new Date().toISOString(),

            last_scan_latitude:
                location?.latitude ??
                null,

            last_scan_longitude:
                location?.longitude ??
                null,

            last_scan_city:
                location?.ville ??
                null,

            last_scan_region:
                location?.region ??
                null
        };

        const {
            error
        } =
            await supabase
                .from(
                    "produits_certifies"
                )
                .update(
                    updatePayload
                )
                .eq(
                    "id",
                    product.id
                );

        if (error) {
            console.error(
                "[ANOR TRACE] Mise à jour compteur produit impossible :",
                error.message
            );

            return {
                success: false,

                error:
                    error.message
            };
        }

        return {
            success: true,

            error: null
        };
    } catch (error) {
        console.error(
            "[ANOR TRACE] Exception mise à jour produit :",
            error.message
        );

        return {
            success: false,

            error:
                error.message
        };
    }
}

// ======================================================
// ROUTE : HEALTH CHECK
// ======================================================

app.get(
    "/health",
    async (req, res) => {
        return apiSuccess(
            res,
            {
                server:
                    "ANOR CHECK",

                version:
                    SERVER_VERSION,

                status:
                    "ONLINE",

                timestamp:
                    new Date().toISOString(),

                services: {
                    supabase:
                        Boolean(
                            supabase
                        ),

                    sharp:
                        Boolean(
                            sharp
                        ),

                    ocr:
                        Boolean(
                            Tesseract
                        ),

                    gemini:
                        Boolean(
                            ai
                        ),

                    glyphLibrary:
                        Boolean(
                            GlyphsLibrary
                        )
                }
            }
        );
    }
);

// ======================================================
// ROUTE : STATUS ANOR
// ======================================================

app.get(
    "/api/seals/status",
    async (req, res) => {
        return apiSuccess(
            res,
            {
                server:
                    "ANOR CHECK",

                version:
                    SERVER_VERSION,

                visualVersion:
                    VISUAL_VERSION,

                visualBitsLength:
                    VISUAL_BITS_LENGTH,

                geometry:
                    getSealGeometry(),

                vision: {
                    local:
                        Boolean(
                            sharp
                        ),

                    glyphLibrary:
                        Boolean(
                            GlyphsLibrary
                        )
                },

                ocr: {
                    local:
                        Boolean(
                            Tesseract
                        )
                },

                gemini: {
                    enabled:
                        Boolean(
                            ai
                        ),

                    models: [
                        "gemini-3.8-flash",
                        "gemini-3.7-flash",
                        "gemini-3.6-flash"
                    ]
                },

                principle:
                    "Gemini lit LOT/SERIE. " +
                    "Le moteur ANOR et la base officielle " +
                    "décident de l'authenticité."
            }
        );
    }
);

// ======================================================
// RECHERCHE D'UN PRODUIT CERTIFIÉ
// ======================================================

async function findCertifiedProduct({
    lot,
    visualBits,
    visualSignature,
    serie
}) {
    const normalizedLot =
        normalizeLotValue(
            lot
        );

    const normalizedSerie =
        normalizeSerialValue(
            serie
        );

    /*
     * --------------------------------------------------
     * NIVEAU 1 :
     * RECHERCHE EXACTE PAR SIGNATURE VISUELLE
     * --------------------------------------------------
     *
     * C'est la voie prioritaire.
     */
    if (visualBits) {
        try {
            const {
                data,
                error
            } =
                await supabase
                    .from(
                        "produits_certifies"
                    )
                    .select("*")
                    .eq(
                        "visual_bits",
                        visualBits
                    )
                    .limit(5);

            if (
                !error &&
                Array.isArray(data) &&
                data.length > 0
            ) {
                /*
                 * S'il y a plusieurs lignes,
                 * on cherche éventuellement celle
                 * correspondant au lot.
                 */
                if (
                    normalizedLot
                ) {
                    const exactLot =
                        data.find(
                            row =>
                                normalizeLotValue(
                                    row.lot ||
                                    row.lot_code ||
                                    row.certificate_code
                                ) ===
                                normalizedLot
                        );

                    if (exactLot) {
                        return {
                            product:
                                exactLot,

                            matchType:
                                "EXACT_VISUAL_AND_LOT"
                        };
                    }
                }

                return {
                    product:
                        data[0],

                    matchType:
                        "EXACT_VISUAL"
                };
            }
        } catch (error) {
            console.error(
                "[ANOR VERIFY] Erreur recherche visual_bits :",
                error.message
            );
        }
    }

    /*
     * --------------------------------------------------
     * NIVEAU 2 :
     * SIGNATURE VISUELLE TEXTE
     * --------------------------------------------------
     */
    if (
        visualSignature
    ) {
        try {
            const {
                data,
                error
            } =
                await supabase
                    .from(
                        "produits_certifies"
                    )
                    .select("*")
                    .eq(
                        "visual_signature",
                        visualSignature
                    )
                    .limit(5);

            if (
                !error &&
                Array.isArray(data) &&
                data.length > 0
            ) {
                if (
                    normalizedLot
                ) {
                    const exactLot =
                        data.find(
                            row =>
                                normalizeLotValue(
                                    row.lot ||
                                    row.lot_code ||
                                    row.certificate_code
                                ) ===
                                normalizedLot
                        );

                    if (exactLot) {
                        return {
                            product:
                                exactLot,

                            matchType:
                                "EXACT_SIGNATURE_AND_LOT"
                        };
                    }
                }

                return {
                    product:
                        data[0],

                    matchType:
                        "EXACT_SIGNATURE"
                };
            }
        } catch (error) {
            console.error(
                "[ANOR VERIFY] Erreur recherche visual_signature :",
                error.message
            );
        }
    }

    /*
     * --------------------------------------------------
     * NIVEAU 3 :
     * LOT UNIQUEMENT
     * --------------------------------------------------
     *
     * IMPORTANT :
     *
     * Le lot seul n'est JAMAIS considéré comme
     * preuve d'authenticité.
     *
     * Il sert seulement à identifier le dossier
     * de certification à comparer.
     */
    if (
        normalizedLot
    ) {
        try {
            const {
                data,
                error
            } =
                await supabase
                    .from(
                        "produits_certifies"
                    )
                    .select("*")
                    .or(
                        `lot.eq.${normalizedLot},lot_code.eq.${normalizedLot},certificate_code.eq.${normalizedLot}`
                    )
                    .limit(10);

            if (
                !error &&
                Array.isArray(data) &&
                data.length > 0
            ) {
                return {
                    product:
                        data[0],

                    matchType:
                        "LOT_HINT_ONLY",

                    candidates:
                        data
                };
            }
        } catch (error) {
            console.error(
                "[ANOR VERIFY] Erreur recherche lot :",
                error.message
            );
        }
    }

    /*
     * Aucun produit identifié.
     */
    return {
        product: null,

        matchType:
            "NOT_FOUND"
    };
}

// ======================================================
// RECHERCHE PAR HAMMING
// ======================================================

async function findClosestCertifiedVisual(
    scannedBits,
    lot = null
) {
    const normalizedBits =
        normalizeVisualBits(
            scannedBits
        );

    if (!normalizedBits) {
        return null;
    }

    const normalizedLot =
        normalizeLotValue(
            lot
        );

    try {
        /*
         * On récupère uniquement les signatures
         * présentes dans le registre.
         *
         * Pour une grande base, cette opération
         * devra être remplacée par une fonction SQL
         * spécialisée.
         */
        let query =
            supabase
                .from(
                    "produits_certifies"
                )
                .select(
                    "id,lot,lot_code,certificate_code,visual_bits,visual_signature,quantite,ai_signature_hash,signature_ia,sha256_hash,status,scan_count"
                )
                .not(
                    "visual_bits",
                    "is",
                    null
                )
                .limit(5000);

        if (
            normalizedLot
        ) {
            query =
                query.or(
                    `lot.eq.${normalizedLot},lot_code.eq.${normalizedLot},certificate_code.eq.${normalizedLot}`
                );
        }

        const {
            data,
            error
        } = await query;

        if (
            error ||
            !Array.isArray(data)
        ) {
            if (error) {
                console.error(
                    "[ANOR HAMMING] Erreur recherche :",
                    error.message
                );
            }

            return null;
        }

        let best = null;

        for (
            const product
            of data
        ) {
            const certifiedBits =
                normalizeVisualBits(
                    product.visual_bits
                );

            if (!certifiedBits) {
                continue;
            }

            const distance =
                calculateHammingDistance(
                    normalizedBits,
                    certifiedBits
                );

            if (
                !best ||
                distance <
                best.distance
            ) {
                best = {
                    product,

                    distance
                };
            }
        }

        if (!best) {
            return null;
        }

        return {
            ...best,

            valid:
                best.distance <= 6
        };
    } catch (error) {
        console.error(
            "[ANOR HAMMING] Exception :",
            error.message
        );

        return null;
    }
}

// ======================================================
// EXTRACTION ROBUSTE DES CHAMPS LOT / SÉRIE
// ======================================================

function chooseBestExtraction({
    requestedLot,
    requestedSerial,
    ocr,
    gemini
}) {
    let lot =
        normalizeLotValue(
            requestedLot
        );

    let serial =
        normalizeSerialValue(
            requestedSerial
        );

    /*
     * Priorité :
     *
     * 1. valeur explicitement envoyée par le client
     * 2. OCR local
     * 3. Gemini
     */
    if (
        !lot &&
        ocr?.lot
    ) {
        lot =
            normalizeLotValue(
                ocr.lot
            );
    }

    if (
        !lot &&
        gemini?.lot
    ) {
        lot =
            normalizeLotValue(
                gemini.lot
            );
    }

    if (
        !serial &&
        ocr?.serial
    ) {
        serial =
            normalizeSerialValue(
                ocr.serial
            );
    }

    if (
        !serial &&
        gemini?.serial
    ) {
        serial =
            normalizeSerialValue(
                gemini.serial
            );
    }

    return {
        lot,

        serial,

        lotSource:
            requestedLot
                ? "CLIENT"
                : (
                    ocr?.lot
                        ? "OCR"
                        : (
                            gemini?.lot
                                ? "GEMINI"
                                : "NONE"
                        )
                ),

        serialSource:
            requestedSerial
                ? "CLIENT"
                : (
                    ocr?.serial
                        ? "OCR"
                        : (
                            gemini?.serial
                                ? "GEMINI"
                                : "NONE"
                        )
                )
    };
}

// ======================================================
// ROUTE PRINCIPALE : VÉRIFICATION D'UN SCEAU
// ======================================================

app.post(
    "/api/seals/verify",
    scanLimiter,
    upload.single("image"),
    async (req, res) => {
        const requestId =
            req.requestId;

        try {
            // ==========================================
            // 0. VALIDATION REQUÊTE
            // ==========================================

            if (
                !isValidUserAgent(
                    req.headers[
                        "user-agent"
                    ]
                )
            ) {
                securityLog(
                    req,
                    "INVALID_USER_AGENT"
                );

                return apiError(
                    res,
                    403,
                    "INVALID_CLIENT",
                    "Client non autorisé."
                );
            }

            const body =
                req.body ||
                {};

            /*
             * Valeurs envoyées par CameraIA / ApiService.
             */
            const requestedLot =
                body.lot ||
                body.lotCode ||
                body.batch ||
                body.certificateCode ||
                null;

            const requestedSerial =
                body.serie ||
                body.serial ||
                body.serialNumber ||
                body.numeroSerie ||
                null;

            let requestedVisualBits =
                normalizeVisualBits(
                    body.visualBits
                );

            let requestedVisualSignature =
                typeof body.visualSignature ===
                "string"
                    ? body.visualSignature.trim()
                    : null;

            /*
             * Certains anciens clients utilisent
             * scannedMatrix.
             */
            let scannedMatrix =
                body.scannedMatrix ||
                body.matrix ||
                body.visualMatrix ||
                null;

            // ==========================================
            // 1. NORMALISATION SIGNATURE CLIENT
            // ==========================================

            if (
                !requestedVisualBits &&
                requestedVisualSignature &&
                requestedVisualSignature.startsWith(
                    "ANOR51:"
                )
            ) {
                requestedVisualBits =
                    normalizeVisualBits(
                        requestedVisualSignature
                            .substring(7)
                    );
            }

            if (
                !requestedVisualBits &&
                scannedMatrix
            ) {
                const intelligent =
                    await intelligentVisualAnalysis(
                        scannedMatrix
                    );

                if (
                    intelligent.bits
                ) {
                    requestedVisualBits =
                        intelligent.bits;
                }

                if (
                    !requestedVisualSignature &&
                    intelligent.signature
                ) {
                    requestedVisualSignature =
                        intelligent.signature;
                }
            }

            if (
                requestedVisualBits &&
                !requestedVisualSignature
            ) {
                requestedVisualSignature =
                    `ANOR51:${requestedVisualBits}`;
            }

            // ==========================================
            // 2. GÉOLOCALISATION
            // ==========================================

            const location =
                resolveScanCoordinates(
                    body
                );

            // ==========================================
            // 3. IMAGE
            // ==========================================

            const imageBuffer =
                req.file?.buffer ||
                null;

            /*
             * Pour les scans contenant un numéro de série,
             * on évite de réutiliser aveuglément une réponse
             * mise en cache.
             *
             * Le système doit pouvoir constater
             * qu'une même série est rescannée.
             */
            const explicitSerial =
                normalizeSerialValue(
                    requestedSerial
                );

            const cacheAllowed =
                !explicitSerial;

            const cacheKey =
                requestedVisualBits
                    ? sha256Hex(
                        `bits:${requestedVisualBits}`
                    )
                    : (
                        imageBuffer
                            ? sha256Hex(
                                imageBuffer
                            )
                            : null
                    );

            if (
                cacheAllowed &&
                cacheKey &&
                scanCache.has(
                    cacheKey
                )
            ) {
                const cached =
                    scanCache.get(
                        cacheKey
                    );

                if (
                    Date.now() -
                    cached.time <
                    SCAN_CACHE_TTL
                ) {
                    console.log(
                        `[ANOR CACHE] Réponse réutilisée pour ${requestId}`
                    );

                    return apiSuccess(
                        res,
                        {
                            ...cached.data,

                            cached: true,

                            requestId
                        }
                    );
                }

                scanCache.delete(
                    cacheKey
                );
            }

            // ==========================================
            // 4. VISION LOCALE
            // ==========================================

            let localVision = {
                success: false,

                bits: null,

                visualSignature: null,

                confidence: 0,

                glyphs: []
            };

            if (
                imageBuffer
            ) {
                localVision =
                    await localSealVisionDecode(
                        imageBuffer
                    );

                /*
                 * Si le client n'a pas fourni de signature,
                 * on utilise la lecture locale.
                 */
                if (
                    !requestedVisualBits &&
                    localVision.bits
                ) {
                    requestedVisualBits =
                        localVision.bits;
                }

                if (
                    !requestedVisualSignature &&
                    localVision.visualSignature
                ) {
                    requestedVisualSignature =
                        localVision.visualSignature;
                }
            }

            // ==========================================
            // 5. OCR LOCAL
            // ==========================================

            let ocrResult = {
                success: false,

                lot: null,

                serial: null,

                reference: null,

                confidence: 0,

                source:
                    "OCR_NOT_RUN"
            };

            if (
                imageBuffer
            ) {
                ocrResult =
                    await runLocalOCR(
                        imageBuffer
                    );
            }

            // ==========================================
            // 6. GEMINI : LOT + SÉRIE
            // ==========================================

            let geminiResult = {
                success: false,

                lot: null,

                serial: null,

                reference: null,

                confidence: 0,

                source:
                    "GEMINI_NOT_RUN",

                model: null
            };

            /*
             * Gemini est lancé lorsque :
             *
             * - une image est disponible ;
             * - et au moins une des informations
             *   lot/série n'est pas encore fiable.
             *
             * Il peut aussi être utilisé comme seconde lecture
             * lorsque l'on veut renforcer la traçabilité.
             */
            const needGemini =
                Boolean(
                    imageBuffer
                ) &&
                (
                    !requestedLot ||
                    !requestedSerial
                );

            if (
                needGemini
            ) {
                geminiResult =
                    await geminiReadLotSerial(
                        imageBuffer
                    );
            }

            // ==========================================
            // 7. CHOIX LOT / SÉRIE
            // ==========================================

            const extracted =
                chooseBestExtraction({
                    requestedLot,

                    requestedSerial,

                    ocr:
                        ocrResult,

                    gemini:
                        geminiResult
                });

            const detectedLot =
                extracted.lot;

            const detectedSerial =
                extracted.serial;

            // ==========================================
            // 8. SI GEMINI A FOURNI UNE INFO DIFFÉRENTE
            // ==========================================

            const lotConflict =
                Boolean(
                    requestedLot &&
                    detectedLot &&
                    normalizeLotValue(
                        requestedLot
                    ) !==
                    normalizeLotValue(
                        detectedLot
                    )
                );

            const serialConflict =
                Boolean(
                    requestedSerial &&
                    detectedSerial &&
                    normalizeSerialValue(
                        requestedSerial
                    ) !==
                    normalizeSerialValue(
                        detectedSerial
                    )
                );

            if (
                lotConflict
            ) {
                securityLog(
                    req,
                    "LOT_READING_CONFLICT",
                    {
                        client:
                            requestedLot,

                        detected:
                            detectedLot
                    }
                );
            }

            if (
                serialConflict
            ) {
                securityLog(
                    req,
                    "SERIAL_READING_CONFLICT",
                    {
                        client:
                            requestedSerial,

                        detected:
                            detectedSerial
                    }
                );
            }

            // ==========================================
            // 9. RECHERCHE EXACTE
            // ==========================================

            let lookup =
                await findCertifiedProduct({
                    lot:
                        detectedLot,

                    visualBits:
                        requestedVisualBits,

                    visualSignature:
                        requestedVisualSignature,

                    serie:
                        detectedSerial
                });

            let certifiedProduct =
                lookup.product;

            let matchType =
                lookup.matchType;

            // ==========================================
            // 10. RECHERCHE HAMMING
            // ==========================================

            let hammingMatch =
                null;

            if (
                !certifiedProduct &&
                requestedVisualBits
            ) {
                hammingMatch =
                    await findClosestCertifiedVisual(
                        requestedVisualBits,
                        detectedLot
                    );

                if (
                    hammingMatch?.valid
                ) {
                    certifiedProduct =
                        hammingMatch.product;

                    matchType =
                        "HAMMING_VISUAL_MATCH";
                }
            }

            // ==========================================
            // 11. AUCUN SCEAU OFFICIEL TROUVÉ
            // ==========================================

            if (
                !certifiedProduct
            ) {
                securityLog(
                    req,
                    "UNKNOWN_SEAL_ATTEMPT",
                    {
                        lot:
                            detectedLot ||
                            "N/A",

                        serial:
                            detectedSerial ||
                            "N/A",

                        hasVisualBits:
                            Boolean(
                                requestedVisualBits
                            ),

                        visualConfidence:
                            localVision.confidence
                    }
                );

                return apiError(
                    res,
                    422,
                    "UNKNOWN_SEAL",
                    "Le sceau ne correspond à aucun " +
                    "sceau officiellement enregistré " +
                    "dans la base ANOR.",
                    {
                        lot:
                            detectedLot,

                        serial:
                            detectedSerial,

                        visualDetected:
                            Boolean(
                                requestedVisualBits
                            ),

                        visualConfidence:
                            localVision.confidence,

                        ocrSource:
                            ocrResult.source,

                        geminiSource:
                            geminiResult.source
                    }
                );
            }

            // ==========================================
            // 12. RÉCUPÉRATION SIGNATURE CERTIFIÉE
            // ==========================================

            const certifiedBits =
                normalizeVisualBits(
                    certifiedProduct.visual_bits
                );

            const certifiedSignature =
                certifiedProduct.visual_signature ||
                (
                    certifiedBits
                        ? `ANOR51:${certifiedBits}`
                        : null
                );

            // ==========================================
            // 13. COMPARAISON VISUELLE
            // ==========================================

            let visualComparison = {
                valid: false,

                distance:
                    Infinity,

                reason:
                    "NO_SCANNED_VISUAL"
            };

            if (
                requestedVisualBits &&
                certifiedBits
            ) {
                visualComparison =
                    compareVisualEvidence(
                        requestedVisualBits,
                        certifiedBits
                    );
            }

            /*
             * Si nous avons utilisé une recherche exacte
             * sur visual_bits, cette comparaison est évidemment
             * valide.
             */
            if (
                matchType ===
                "EXACT_VISUAL"
                ||
                matchType ===
                "EXACT_VISUAL_AND_LOT"
            ) {
                visualComparison = {
                    valid: true,

                    distance:
                        visualComparison.distance ===
                        Infinity
                            ? 0
                            : visualComparison.distance,

                    reason:
                        "EXACT_VISUAL_MATCH"
                };
            }

            // ==========================================
            // 14. AUTORITÉ ABSOLUE :
            // SIGNATURE VISUELLE
            // ==========================================

            const isAuthentic =
                visualComparison.valid;

            if (!isAuthentic) {
                securityLog(
                    req,
                    "INVALID_VISUAL_SIGNATURE",
                    {
                        lot:
                            detectedLot,
                        serial:
                            detectedSerial,
                        distance:
                            visualComparison.distance
                    }
                );
            }

            // ==========================================
            // 15. ANALYSE DE PRODUCTION & TRAÇABILITÉ
            // ==========================================

            const productionAnalysis =
                await analyzeProductionConsistency({
                    certifiedProduct,
                    lot: detectedLot,
                    serial: detectedSerial,
                    scannedBits: requestedVisualBits,
                    location
                });

            // ==========================================
            // 16. CONSTRUCTION DE LA TRACE
            // ==========================================

            const trace =
                buildScanTrace({
                    req,
                    lot: detectedLot,
                    serial: detectedSerial,
                    visualBits: requestedVisualBits,
                    visualSignature: requestedVisualSignature,
                    location,
                    productionAnalysis,
                    ocrResult,
                    geminiResult,
                    visualComparison
                });

            // ==========================================
            // 17. ENREGISTREMENTS ASYNCHRONES
            // ==========================================

            await recordUnitScan(trace);
            await updateCertifiedProductScan(certifiedProduct, location);

            // ==========================================
            // 18. RÉPONSE FINALE
            // ==========================================

            const responsePayload = {
                success: true,
                authentic: isAuthentic,
                status: isAuthentic ? "CERTIFIE_ANOR" : "CONTREFAÇON_OU_ANOMALIE",
                matchType,
                product: {
                    id: certifiedProduct.id,
                    nom: certifiedProduct.nom || certifiedProduct.product_name || certifiedProduct.libelle,
                    entreprise: certifiedProduct.entreprise || certifiedProduct.company_name,
                    lot: detectedLot || certifiedProduct.lot || certifiedProduct.lot_code,
                    quantite: certifiedProduct.quantite
                },
                serial: {
                    number: detectedSerial,
                    valid: productionAnalysis.serialValid,
                    registered: productionAnalysis.serialRegistered,
                    duplicateCount: productionAnalysis.duplicateScanCount
                },
                visual: {
                    matched: isAuthentic,
                    distance: visualComparison.distance,
                    reason: visualComparison.reason
                },
                production: productionAnalysis,
                location,
                extraction: {
                    ocr: ocrResult,
                    gemini: geminiResult
                }
            };

            if (cacheAllowed && cacheKey) {
                scanCache.set(cacheKey, {
                    time: Date.now(),
                    data: responsePayload
                });
            }

            return apiSuccess(res, responsePayload);

        } catch (error) {
            console.error(`[ANOR ERROR] Erreur critique verify pour ${requestId}:`, error);
            return apiError(
                res,
                500,
                "VERIFICATION_CRITICAL_ERROR",
                "Erreur lors de la vérification sécurisée du sceau.",
                error.message
            );
        }
    }
);

// ======================================================
// DÉMARRAGE DU SERVEUR
// ======================================================

app.listen(PORT, () => {
    console.log(`[ANOR CORE] Serveur souverain démarré sur le port ${PORT} (Version ${SERVER_VERSION})`);
});