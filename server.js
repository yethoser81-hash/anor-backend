/**
 * ======================================================
 * SYSTEME SOUVERAIN DE CERTIFICATION ANOR - SERVER CORE
 * Version: 17.6.0 (Production Ready - Intelligent Visual Scan Core + Fuzzy Hamming Matching)
 * ======================================================
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();
const JSZip = require("jszip");
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const helmet = require("helmet");

// Constantes de versioning & environnement global
const SERVER_VERSION = "17.6.0";
const isProduction = process.env.NODE_ENV === "production";

// [AJOUT A] Constantes ANOR Visual Matrix
const VISUAL_VERSION = 1;
const VISUAL_BITS_LENGTH = 51;

// [AJOUT B] Fonctions utilitaires ANOR Visual Matrix

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

const app = express();

// Configuration obligatoire pour Render et les rate-limiters derrière un proxy inversé
app.set('trust proxy', 1);

// Limite stricte de taille de fichier téléversé (10MB)
const upload = multer({ 
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('INVALID_FILE_TYPE'));
        }
    }
}); 

const supabase = require('./config/database');
const SealRenderer = require('./engine/sealRenderer');

// Désactivation de l'en-tête de révélation Express
app.disable("x-powered-by");

// Configuration CORS renforcée
const allowedOrigins = [
    'http://localhost:3000',
    'https://anor-backend.onrender.com',
    'capacitor://localhost',
    'http://localhost',
    'https://localhost'
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) {
            return callback(null, true);
        }
        const isLocalDevIP = /^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}):\d+$/.test(origin);

        if (allowedOrigins.indexOf(origin) !== -1 || isLocalDevIP || !isProduction) {
            callback(null, true);
        } else {
            callback(new Error('Bloqué par la politique CORS (NotSameOrigin)'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Version', 'X-Request-Id']
}));

// ==========================================
// 🛡️ SÉCURITÉ & MIDDLEWARES GLOBAUX
// ==========================================
app.use(
    helmet({
        crossOriginEmbedderPolicy: false,
        contentSecurityPolicy: false
    })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
});

app.use((req, res, next) => {
    const startTime = Date.now();
    const requestId = req.headers["x-request-id"] || crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);

    res.on("finish", () => {        const duration = Date.now() - startTime;
        if (!isProduction) {
            console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms) [ID: ${requestId}]`);
        }    });

    next();
});

const scanLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 60,
    message: { status: 429, error: "TROP_DE_REQUETES", message: "Trop de requêtes de scan de ce périphérique. Veuillez ralentir." }
});

const recentRequests = new Map();
const REQUEST_TTL = 30000;
const MAX_RECENT_REQUESTS = 10000;

setInterval(() => {
    const now = Date.now();
    for (const [id, time] of recentRequests.entries()) {    if (now - time > REQUEST_TTL) {
            recentRequests.delete(id);        }
    }
}, 10000);

app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    const id = req.headers["x-request-id"];
    if (!id) {        return next();    }

    const replayKey = `${req.method}:${req.path}:${id}`;

    if (recentRequests.has(replayKey)) {
        return apiError(
            res,
            409,
            "DUPLICATE_REQUEST",
            "Cette requête a déjà été traitée."
        );
    }

    if (recentRequests.size >= MAX_RECENT_REQUESTS) {
        const oldestKey = recentRequests.keys().next().value;
        recentRequests.delete(oldestKey);    }

    recentRequests.set(replayKey, Date.now());    next();   });

function apiSuccess(res, data = {}, status = 200) {
    return res
        .status(status)
        .json({
            success: true,
            requestId: res.getHeader("X-Request-Id") || res.req?.headers["x-request-id"] || null,
            timestamp: Date.now(),
            ...data
        });
}

function apiError(res, status = 500, code = "SERVER_ERROR", message = "Une erreur est survenue.", details = null) {
    const payload = {
        success: false,
        error: {
            code,
            message
        },
        timestamp: Date.now()
    };
    if (details) {
        payload.error.details = details;
    }
    return res.status(status).json(payload);
}

function securityLog(req, event, details = {}) {
    console.warn(
        JSON.stringify({
            time: new Date().toISOString(),
            requestId: req.headers["x-request-id"] || req.requestId || null,
            ip: req.ip,
            event,
            details        })
    );   }

function sanitizeFileName(filename) {
    if (!filename) return 'unnamed_file';
    return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function isValidUserAgent(agent) {
    if (!agent || agent.length > 400) {
        return false;
    }
    return true;
}

setInterval(() => {
    if (global.gc) {
        global.gc();
    }
}, 600000);

app.use(express.static(__dirname));

app.get(['/', '/index.html'], (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get("/health", async (req, res) => {
    let database = "DOWN";
    try {
        const { error } = await supabase
            .from("produits_certifies")
            .select("lot")
            .limit(1);

        if (!error) {
            database = "UP";
        }
    } catch (e) {
        database = "DOWN";
    }

    return apiSuccess(res, {
        status: "ONLINE",
        engine: `ANOR Core ${SERVER_VERSION}`,
        database,
        uptime: process.uptime(),
        memory: process.memoryUsage().rss,
        node: process.version
    });
});

/**
 * ======================================================
 * MOTEUR MATHÉMATIQUE DE TOLÉRANCE (DISTANCE DE HAMMING / FUZZY MATCHING)
 * Permet de comparer la signature binaire reçue du terrain avec tolérance d'erreur
 * ======================================================
 */
// [MODIFICATION 6] Remplacement de l'ancien moteur Hamming par le nouveau standard ANOR 51-bits
function calculateHammingDistance(str1, str2) {

    if (
        !str1 ||
        !str2 ||
        str1.length !== str2.length
    ) {
        return Infinity;
    }

    let distance = 0;

    for (
        let i = 0;
        i < str1.length;
        i++
    ) {

        if (
            str1[i] !== str2[i]
        ) {
            distance++;
        }
    }

    return distance;
}

/**
 * ======================================================
 * MOTEUR D'EXTRACTION VISUELLE ET D'ANALYSE INTELLIGENTE
 * Analyse l'image du sceau ou la matrice pour extraire le lot / la signature
 * ======================================================
 */
// [MODIFICATION 7] Remplacement complet de intelligentVisualAnalysis
async function intelligentVisualAnalysis(
    scannedMatrix
) {

    if (!scannedMatrix) {

        return {
            lot: null,
            signature: null,
            visualBits: null,
            visualCandidates: [],
            confidence: 0
        };
    }

    // =========================================================
    // LOT TEXTE
    // =========================================================

    if (
        typeof scannedMatrix === "string"
    ) {

        const trimmed =
            scannedMatrix.trim();

        if (!trimmed) {

            return {
                lot: null,
                signature: null,
                visualBits: null,
                visualCandidates: [],
                confidence: 0
            };
        }

        return {

            lot: trimmed,

            signature: null,

            visualBits: null,

            visualCandidates: [],

            confidence: 0.95
        };
    }

    // =========================================================
    // MATRICE VISUELLE
    // =========================================================

    if (
        typeof scannedMatrix === "object"
    ) {

        const visualBits =
            normalizeVisualBits(
                scannedMatrix.bits ||
                scannedMatrix.visualBits
            );

        const candidates =
            Array.isArray(
                scannedMatrix.candidates
            )
                ? scannedMatrix.candidates
                    .map(normalizeVisualBits)
                    .filter(Boolean)
                : [];

        const uniqueCandidates =
            [
                ...(visualBits
                    ? [visualBits]
                    : []),
                ...candidates
            ].filter(
                (value, index, array) =>
                    array.indexOf(value) === index
            );

        return {

            lot:
                scannedMatrix.lot ||
                scannedMatrix.batch ||
                null,

            signature:
                scannedMatrix.secureSignature ||
                scannedMatrix.signature ||
                scannedMatrix.hash ||
                null,

            visualBits,

            visualCandidates:
                uniqueCandidates,

            confidence:
                visualBits
                    ? 0.90
                    : 0.20
        };
    }

    return {

        lot: null,

        signature: null,

        visualBits: null,

        visualCandidates: [],

        confidence: 0
    };
}

app.post('/api/seals/generate-batch-seal', upload.fields([
    { name: 'certificat_pdf', maxCount: 1 },
    { name: 'visuel_produit', maxCount: 1 }
]), async (req, res) => {
    const startTime = Date.now();
    try {
        const {
            nom_produit,
            nom_producteur,
            lot,
            quantite,
            type_emballage,
            composition,
            pays_origine,
            date_certificat_conformite,
            date_fabrication,
            date_peremption
        } = req.body;

        if (!lot || !quantite || !type_emballage) {
            return apiError(res, 400, "MISSING_PARAMETERS", "Les champs lot, quantite et type_emballage sont obligatoires.");
        }

        const parsedQuantite = parseInt(quantite, 10);
        if (isNaN(parsedQuantite) || parsedQuantite <= 0) {
            return apiError(res, 400, "INVALID_QUANTITY", "La quantité doit être un nombre entier positif.");
        }

        const pdfFile = req.files ? ((req.files['certificat_pdf'] && req.files['certificat_pdf'][0]) || (req.files['pdf'] && req.files['pdf'][0])) : null;
        const visuelFile = req.files ? ((req.files['visuel_produit'] && req.files['visuel_produit'][0]) || (req.files['visuel'] && req.files['visuel'][0]) || (req.files['image'] && req.files['image'][0])) : null;

        const pdfBufferData = pdfFile ? { buffer: pdfFile.buffer, mimetype: pdfFile.mimetype, originalname: pdfFile.originalname } : null;
        const visuelBufferData = visuelFile ? { buffer: visuelFile.buffer, mimetype: visuelFile.mimetype, originalname: visuelFile.originalname } : null;

        const certificateCode = `${lot}`;
        
        // [MODIFICATION 8] Dérivation des 51 bits visuels ANOR
        const secureSignature =
            crypto
                .createHash('sha256')
                .update(
                    `${lot}-${Date.now()}-${Math.random()}`
                )
                .digest('hex');

        const visualBits =
            SealRenderer.deriveVisualBits(
                secureSignature
            );

        if (
            !visualBits ||
            visualBits.length !== 51
        ) {
            throw new Error(
                "La matrice visuelle ANOR doit contenir exactement 51 bits."
            );
        }
        
        // [MODIFICATION 9] Passage des visualBits au renderer
        const imageBuffer =
            await SealRenderer.renderSealToBuffer(
                {
                    secureSignature,
                    visualBits
                },
                {
                    lot,
                    quantite: parsedQuantite,
                    type_emballage,
                    productName: nom_produit,
                    nom_produit,
                    nom_producteur,
                    isMasterSeal: true,
                    masterSerialLabel: `SÉRIE : DM / ${parsedQuantite.toLocaleString('fr-FR')}`
                }
            );

        if (!Buffer.isBuffer(imageBuffer)) {
            throw new Error("Le renderer n'a pas renvoyé un Buffer valide.");
        }

        const rawBase64 = imageBuffer.toString("base64").replace(/\r|\n/g, "");

        let pdfUrl = null;
        let visuelUrl = null;

        if (pdfBufferData) {
            try {
                const pdfPath = `${Date.now()}_${sanitizeFileName(pdfBufferData.originalname)}`;
                const { data: pdfData, error: pdfErr } = await supabase.storage
                    .from('certificat-pdf')
                    .upload(pdfPath, pdfBufferData.buffer, { contentType: pdfBufferData.mimetype, upsert: true });

                if (!pdfErr && pdfData) {
                    const { data: publicUrlData } = supabase.storage
                        .from('certificat-pdf')
                        .getPublicUrl(pdfPath);
                    pdfUrl = publicUrlData ? publicUrlData.publicUrl : null;
                }
            } catch (err) {
                console.warn("⚠️ Exception Storage (PDF) :", err.message);
            }
            if (!pdfUrl) {
                pdfUrl = `data:${pdfBufferData.mimetype};base64,${pdfBufferData.buffer.toString('base64')}`;
            }
        }

        if (visuelBufferData) {
            try {
                const visuelPath = `${Date.now()}_${sanitizeFileName(visuelBufferData.originalname)}`;
                const { data: visuelData, error: visuelErr } = await supabase.storage
                    .from('Produits')
                    .upload(visuelPath, visuelBufferData.buffer, { contentType: visuelBufferData.mimetype, upsert: true });

                if (!visuelErr && visuelData) {
                    const { data: publicUrlData } = supabase.storage
                        .from('Produits')
                        .getPublicUrl(visuelPath);
                    visuelUrl = publicUrlData ? publicUrlData.publicUrl : null;
                }
            } catch (err) {      console.warn("⚠️ Exception Storage (Visuel) :", err.message);            }
            if (!visuelUrl) {     visuelUrl = `data:${visuelBufferData.mimetype};base64,${visuelBufferData.buffer.toString('base64')}`;            }
        }

        // [MODIFICATION 10] Mise à jour du payloadDB avec versioning et matrix_hash sur les 51 bits
        const payloadDB = {
            certificate_code: certificateCode,
            lot: lot,
            quantite: parsedQuantite,
            type_emballage: type_emballage,
            nom_produit: nom_produit || null,
            nom_producteur: nom_producteur || null,
            composition: composition || null,
            pays_origine: pays_origine || null,
            date_certificat_conformite: date_certificat_conformite || null,
            date_fabrication: date_fabrication || null,
            date_peremption: date_peremption || null,
            certificat_pdf_url: pdfUrl,
            visuel_produit_url: visuelUrl,
            
            glyph_payload: {
                visualVersion: VISUAL_VERSION,
                secureSignature,
                visualBits,
                lot
            },
            
            matrix_hash:
                sha256Hex(visualBits),
                
            ai_signature_hash:
                secureSignature,
                
            sha256_hash:
                secureSignature,
                
            signature_ia:
                secureSignature,
                
            engine_version: SERVER_VERSION,
            statut: "CERTIFIÉ",
            scan_count: 0
        };

        let { data, error } = await supabase
            .from('produits_certifies')
            .upsert(payloadDB, { onConflict: 'lot' })
            .select();

        if (error) throw error;

        const printNoticeContent = 
`================================================================================
            AGENCE Nationale de NORMALISATION ET DE QUALITÉ (ANOR)
                NOTICE D'INSTRUCTION TECHNIQUE ET D'IMPRESSION
================================================================================

1. IDENTIFICATION DU LOT ET DU PRODUIT :
    - Numéro de Lot   : ${lot}
    - Nom du Produit : ${nom_produit || 'N/A'}
    - Producteur     : ${nom_producteur || 'N/A'}
    - Quantité certifiée : ${parsedQuantite.toLocaleString('fr-FR')} unités
    - Type d'emballage : ${type_emballage}

2. CONSIGNES TECHNIQUES D'IMPRESSION DU SCEAU :
    - Le fichier 'sceau_ANOR_MASTER.png' inclus dans ce paquet est la matrice Mère.
    - Impression recommandée : Quadrichromie haute résolution (300 DPI minimum).
    - Dimensions minimales du glyph central : 15mm x 15mm pour garantir la lecture.

Fait à Yaoundé, le ${new Date().toLocaleDateString('fr-FR')}
Système Souverain de Certification - ANOR Engine ${SERVER_VERSION}
================================================================================`;

        const zip = new JSZip();
        zip.file("NOTICE_DIMPRESSION_ET_INSTRUCTIONS.txt", printNoticeContent);
        
        // [MODIFICATION 11] Ajout visualVersion et visualBits dans certification.json
        zip.file(
            "certification.json",
            JSON.stringify(
                {
                    lot,
                    nom_produit,
                    nom_producteur,
                    quantite: parsedQuantite,
                    visualVersion: VISUAL_VERSION,
                    visualBits,
                    signature_ia: secureSignature,
                    created_at:
                        new Date().toISOString()
                },
                null,
                4
            )
        );
        zip.file("sceau_ANOR_MASTER.png", imageBuffer);

        const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });

        return apiSuccess(res, {
            message: "Sceau généré avec succès.",
            lot,
            sha256_hash: secureSignature,
            imageUrl: `data:image/png;base64,${rawBase64}`,
            zipUrl: "data:application/zip;base64," + zipBuffer.toString("base64"),
            data: data ? data[0] : null,
            processingTimeMs: Date.now() - startTime
        }, 200);

    } catch (error) {        console.error("❌ Erreur Forge Backend Directe:", error);
        return apiError(res, 500, "FORGE_ERROR", error.message);    }     });

// [MODIFICATION 12] Remplacement ENTIER du endpoint /api/seals/verify
app.post(
    '/api/seals/verify',
    scanLimiter,
    async (req, res) => {

        const startTime =
            Date.now();

        try {

            if (
                !isValidUserAgent(
                    req.headers["user-agent"]
                )
            ) {

                securityLog(
                    req,
                    "INVALID_USER_AGENT"
                );

                return apiError(
                    res,
                    400,
                    "INVALID_CLIENT",
                    "Client non valide."
                );
            }

            const {
                scannedMatrix,
                lot,
                location,
                locationMethod,
                deviceMetadata
            } = req.body;

            if (
                !lot &&
                !scannedMatrix
            ) {

                return apiError(
                    res,
                    400,
                    "MISSING_SCAN",
                    "Données de scan insuffisantes."
                );
            }

            let row = null;

            let verificationMode =
                "LOT";

            let matchConfidence =
                1.0;

            // =====================================================
            // 1. VÉRIFICATION PAR LOT (Recherche exacte insensible à la casse)
            // =====================================================

            if (lot) {

                const cleanLot =
                    String(lot).trim();

                const {
                    data,
                    error
                } = await supabase
                    .from(
                        'produits_certifies'
                    )
                    .select('*')
                    .ilike(
                        'lot',
                        cleanLot
                    )
                    .maybeSingle();

                if (
                    !error &&
                    data
                ) {

                    row = data;
                }
            }

            // =====================================================
            // 2. LECTURE VISUELLE (Si pas de lot ou lot non trouvé)
            // =====================================================

            if (
                !row &&
                scannedMatrix
            ) {

                verificationMode =
                    "VISUAL_SCAN";

                const analysis =
                    await intelligentVisualAnalysis(
                        scannedMatrix
                    );

                // -------------------------------------------------
                // 2A. Si le decoder a aussi obtenu le lot par OCR/fallback
                // -------------------------------------------------

                if (
                    analysis.lot
                ) {

                    const {
                        data
                    } = await supabase
                        .from(
                            'produits_certifies'
                        )
                        .select('*')
                        .ilike(
                            'lot',
                            analysis.lot.trim()
                        )
                        .maybeSingle();

                    if (data) {
                        row = data;
                        verificationMode =
                            "VISUAL_LOT_MATCH";
                    }
                }

                // -------------------------------------------------
                // 2B. MATCH EXACT DES 51 BITS (Optimisation par Hash)
                // -------------------------------------------------

                if (
                    !row &&
                    analysis.visualCandidates &&
                    analysis.visualCandidates.length
                ) {

                    for (
                        const bits
                        of analysis.visualCandidates
                    ) {

                        // On recalcule le hash des bits lus pour recherche rapide
                        const visualHash =
                            sha256Hex(bits);

                        const {
                            data
                        } = await supabase
                            .from(
                                'produits_certifies'
                            )
                            .select('*')
                            .eq(
                                'matrix_hash',
                                visualHash
                            )
                            .maybeSingle();

                        // Double vérification de sécurité sur les bits bruts
                        if (
                            data &&
                            data.glyph_payload &&
                            data.glyph_payload.visualBits === bits
                        ) {

                            row = data;

                            matchConfidence =
                                1.0;

                            verificationMode =
                                "VISUAL_EXACT_MATCH";

                            break; // Match trouvé, on arrête
                        }
                    }
                }

                // -------------------------------------------------
                // 2C. MATCH FUZZY (Distance de Hamming sur les 51 bits)
                // -------------------------------------------------

                if (
                    !row &&
                    analysis.visualCandidates &&
                    analysis.visualCandidates.length
                ) {

                    // Récupération des sceaux récents/actifs pour comparaison (limite de performance)
                    // TODO: Optimiser via une procédure stockée SQL pour gros volumes
                    const {
                        data: allProducts
                    } = await supabase
                        .from(
                            'produits_certifies'
                        )
                        .select('*')
                        .not(
                            'matrix_hash',
                            'is',
                            null
                        )
                        .limit(2000);

                    let bestMatch =
                        null;

                    let lowestDistance =
                        Infinity;

                    let secondLowestDistance =
                        Infinity;

                    let bestCandidateBits =
                        null;

                    // Pour chaque candidat visuel retourné par l'analyse
                    for (
                        const candidateBits
                        of analysis.visualCandidates
                    ) {

                        // On compare avec chaque produit en base
                        for (
                            const product
                            of (allProducts || [])
                        ) {

                            const targetBits =
                                normalizeVisualBits(
                                    product
                                        .glyph_payload
                                        ?.visualBits
                                );

                            if (!targetBits) {
                                continue;
                            }

                            const distance =
                                calculateHammingDistance(
                                    candidateBits,
                                    targetBits
                                );

                            // Suivi du meilleur et second meilleur match pour exclusion d'ambiguïté
                            if (
                                distance <
                                lowestDistance
                            ) {

                                secondLowestDistance =
                                    lowestDistance;

                                lowestDistance =
                                    distance;

                                bestMatch =
                                    product;

                                bestCandidateBits =
                                    candidateBits;

                            } else if (
                                distance <
                                secondLowestDistance
                            ) {

                                secondLowestDistance =
                                    distance;
                            }
                        }
                    }

                    /*
                     * Critères de décision ANOR Core v17 :
                     * Sur une matrice de 51 bits.
                     *
                     * Maximum tolérance :
                     * 6 erreurs ≈ 11.8 % du signal total (robuste aux dégradations légères d'impression).
                     *
                     * Critère d'ambiguïté :
                     * On exige aussi une marge d'au moins 2 bits entre
                     * le meilleur et le second candidat pour éviter les faux positifs sur lots proches.
                     */

                    const MAX_ALLOWED_ERRORS = 6;

                    const sufficientMargin =
                        secondLowestDistance === Infinity ||
                        (
                            secondLowestDistance -
                            lowestDistance
                        ) >= 2;

                    if (
                        bestMatch &&
                        lowestDistance <=
                            MAX_ALLOWED_ERRORS &&
                        sufficientMargin
                    ) {

                        row =
                            bestMatch;

                        // Calcul du score de confiance basé sur la distance
                        // Un match fuzzy dégrade la confiance initiale.
                        matchConfidence =
                            Math.max(
                                0.70, // Confiance plancher pour un match fuzzy valide
                                1 -
                                (
                                    lowestDistance /
                                    VISUAL_BITS_LENGTH
                                )
                            );

                        verificationMode =
                            "VISUAL_FUZZY_MATCH";
                    }
                }
            }

            // =====================================================
            // 3. AUCUN MATCH = REJET (Contrefaçon ou Sceau inconnu)
            // =====================================================

            // [MODIFICATION 13] Suppression explicite de l'ancien FALLBACK_TEST_MODE ici.
            // Si 'row' est null, c'est un rejet définitif.

            if (!row) {

                securityLog(
                    req,
                    "UNKNOWN_SEAL_ATTEMPT",
                    {
                        lot:
                            lot || "N/A"
                    }
                );

                return apiError(
                    res,
                    404,
                    "UNKNOWN_SEAL",
                    "Sceau inconnu ou non authentifié.",
                    {
                        status:
                            "CONTREFAÇON_REJETEE",

                        processingTime:
                            Date.now() -
                            startTime,

                        engineVersion:
                            SERVER_VERSION
                    }
                );
            }

            // =====================================================
            // 4. ENREGISTREMENT DU SCAN & LOGIQUE ANTI-DUPLICATION
            // =====================================================

            const currentScanCount =
                (row.scan_count || 0) + 1;

            const currentLocation =
                location || "Inconnue";

            let warningFlag =
                null;

            // Détection de duplication basée sur la vélocité géographique
            if (
                row.last_scan_location &&
                row.last_scan_location !==
                    currentLocation &&
                row.last_scanned_at
            ) {

                const timeDiffMinutes =
                    (
                        new Date() -
                        new Date(
                            row.last_scanned_at
                        )
                    ) /
                    (1000 * 60);

                // Si scan à deux endroits différents en moins de 15 minutes
                if (
                    timeDiffMinutes < 15
                ) {

                    warningFlag =
                        "SUSPICION_DUPLICATION_SCEAU";
                }
            }

            const updatePayload = {

                scan_count:
                    currentScanCount,

                last_scan_location:
                    currentLocation,

                location_method:
                    locationMethod ||
                    null,

                last_scanned_at:
                    new Date()
            };

            if (deviceMetadata) {

                updatePayload.device_metadata =
                    deviceMetadata;
            }

            // Mise à jour asynchrone (non bloquante pour la réponse)
            supabase
                .from(
                    'produits_certifies'
                )
                .update(
                    updatePayload
                )
                .eq(
                    'lot',
                    row.lot
                )
                .then(
                    ({
                        error: updateErr
                    }) => {

                        if (updateErr) {

                            console.warn(
                                "⚠️ Mise à jour scan échouée:",
                                updateErr.message
                            );
                        }
                    }
                )
                .catch(() => {});

            // =====================================================
            // 5. RÉPONSE UNIQUE ET COHÉRENTE
            // =====================================================

            return apiSuccess(
                res,
                {

                    status:
                        "AUTHENTIQUE",

                    verified:
                        true,

                    confidence:
                        matchConfidence,

                    score:
                        `${(
                            matchConfidence *
                            100
                        ).toFixed(1)}%`,

                    confidenceScore:
                        matchConfidence,

                    security_alert:
                        warningFlag,

                    securityAlert:
                        warningFlag,

                    lot:
                        row.lot,

                    batch:
                        row.lot,

                    nom_produit:
                        row.nom_produit ||
                        "Produit Certifié Conforme",

                    nomProduit:
                        row.nom_produit ||
                        "Produit Certifié Conforme",

                    nom_producteur:
                        row.nom_producteur ||
                        "Producteur Agréé",

                    nomProducteur:
                        row.nom_producteur ||
                        "Producteur Agréé",

                    pays:
                        row.pays_origine ||
                        "Cameroun",

                    pays_origine:
                        row.pays_origine ||
                        "Cameroun",

                    quantite:
                        row.quantite,

                    type_emballage:
                        row.type_emballage,

                    typeEmballage:
                        row.type_emballage,

                    composition:
                        row.composition ||
                        null,

                    packaging:
                        row.type_emballage ||
                        null,

                    visualUrl:
                        row.visuel_produit_url ||
                        null,

                    visuel_produit_url:
                        row.visuel_produit_url ||
                        null,

                    visualProduitUrl:
                        row.visuel_produit_url ||
                        null,

                    certificat_pdf_url:
                        row.certificat_pdf_url ||
                        null,

                    certificatPdfUrl:
                        row.certificat_pdf_url ||
                        null,

                    scan_count:
                        currentScanCount,

                    scanCount:
                        currentScanCount,

                    certified_at:
                        row.created_at ||
                        row.date_certificat_conformite,

                    certDate:
                        row.date_certificat_conformite ||
                        row.created_at,

                    prodDate:
                        row.date_fabrication ||
                        "N/A",

                    expDate:
                        row.date_peremption ||
                        "N/A",

                    norme:
                        "ANOR NC-ISO",

                    processingTime:
                        Date.now() -
                        startTime,

                    processingTimeMs:
                        Date.now() -
                        startTime,

                    engineVersion:
                        SERVER_VERSION,

                    visualVersion:
                        VISUAL_VERSION,

                    verificationMode:
                        verificationMode,

                    serverTimestamp:
                        Date.now()
                }
            );

        } catch (error) {

            console.error(
                "❌ Erreur vérification:",
                error
            );

            return apiError(
                res,
                500,
                "SERVER_ERROR",
                "Erreur interne pendant la vérification."
            );
        }
    }
);

app.post('/api/seals/feedback', scanLimiter, async (req, res) => {
    try {
        const { lot, luminance, isLowLight, contrastScore, rawFrameSnippet } = req.body;
        const safeSnippet = (rawFrameSnippet && typeof rawFrameSnippet === 'string') ? rawFrameSnippet.substring(0, 500) : null;

        await supabase
            .from('telemetrie_scans')
            .insert([{
                lot: lot || "INCONNU",
                luminance: typeof luminance === 'number' ? luminance : null,
                is_low_light: !!isLowLight,
                contrast_score: typeof contrastScore === 'number' ? contrastScore : null,
                frame_snippet: safeSnippet,
                created_at: new Date()
            }]);

        return apiSuccess(res, {
            adaptiveParameters: { recommendedLightBoost: !!isLowLight },
            message: "Télémétrie intégrée avec succès."
        });
    } catch (err) {
        return apiError(res, 500, "TELEMETRY_ERROR", "Échec d'enregistrement de la télémétrie.");
    }
});

app.use((err, req, res, next) => {
    if (err && err.message === 'INVALID_FILE_TYPE') {
        return apiError(res, 400, "INVALID_FILE_TYPE", "Le format de fichier téléversé n'est pas autorisé.");
    }
    return apiError(res, 500, "SERVER_ERROR", "Erreur interne du serveur.");
});

app.use((req, res) => {
    return apiError(res, 404, "ROUTE_NOT_FOUND", "Route inexistante.");
});

const PORT = process.env.PORT || 10000;
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[EXPERT BACKEND] Serveur Souverain ANOR v${SERVER_VERSION} prêt sur http://0.0.0.0:${PORT}`);
});

function shutdown(signal) {
    server.close(() => {
        process.exit(0);
    });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));