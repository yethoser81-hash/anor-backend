/**
 * ======================================================
 * SYSTEME SOUVERAIN DE CERTIFICATION ANOR - SERVER CORE
 * Version: 17.0.0 (Production Ready)
 * ======================================================
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();
const JSZip = require("jszip");
const fs = require("fs");
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const helmet = require("helmet");

// Constantes de versioning & environnement global
const SERVER_VERSION = "17.0.0";
const isProduction = process.env.NODE_ENV === "production";

// Limite stricte de taille de fichier téléversé (10MB)
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); 

const supabase = require('./config/database');
const AiBackendEngine = require('./engine/aiBackendEngine');
const taskQueue = require('./worker');
const SealRenderer = require('./engine/sealRenderer');

const app = express();

// Désactivation de l'en-tête de révélation Express
app.disable("x-powered-by");

// ==========================================
// 🛡️ SÉCURITÉ & MIDDLEWARES GLOBAUX
// ==========================================

// Protection Helmet pour en-têtes HTTP sécurisés
app.use(
    helmet({
        crossOriginEmbedderPolicy: false,
        contentSecurityPolicy: false
    })
);

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// En-têtes complémentaires durcis
app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
});

// Logger de requêtes HTTP
app.use((req, res, next) => {
    const startTime = Date.now();
    const requestId = req.headers["x-request-id"] || crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);

    res.on("finish", () => {
        const duration = Date.now() - startTime;
        if (!isProduction) {
            console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms) [ID: ${requestId}]`);
        }
    });

    next();
});

// Limiteur de requêtes (Rate Limiting)
const scanLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // Max 60 requêtes par minute par IP
    message: { status: 429, error: "TROP_DE_REQUETES", message: "Trop de requêtes de scan de ce périphérique. Veuillez ralentir." }
});

/**
 * ======================================================
 * Protection Anti-Rejeu (Replay Protection)
 * ======================================================
 */
const recentRequests = new Map();
const REQUEST_TTL = 30000; // 30 secondes

setInterval(() => {
    const now = Date.now();
    for (const [id, time] of recentRequests.entries()) {
        if (now - time > REQUEST_TTL) {
            recentRequests.delete(id);
        }
    }
}, 10000);

app.use((req, res, next) => {
    const id = req.headers["x-request-id"];
    if (!id) {
        return next();
    }

    if (recentRequests.has(id)) {
        return apiError(
            res,
            409,
            "DUPLICATE_REQUEST",
            "Cette requête a déjà été traitée."
        );
    }

    recentRequests.set(id, Date.now());
    next();
});

/**
 * ======================================================
 * HELPERS UNIFIÉS DE RÉPONSE ET DE JOURNALISATION
 * ======================================================
 */
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
            details
        })
    );
}

function isValidUserAgent(agent) {
    if (!agent) {
        return false;
    }
    if (agent.length > 400) {
        return false;
    }
    return true;
}

function isValidMatrix(matrix) {
    if (!Array.isArray(matrix)) return false;
    if (matrix.length !== 32) return false;
    for (const row of matrix) {
        if (!Array.isArray(row)) return false;
        if (row.length !== 32) return false;
        for (const value of row) {
            if (value !== 0 && value !== 1) return false;
        }
    }
    return true;
}

// Nettoyage régulier de la mémoire (Déclenché si lancé avec --expose-gc)
setInterval(() => {
    if (global.gc) {
        global.gc();
    }
}, 600000);

// Servir les fichiers statiques
app.use(express.static(__dirname));

// Route principale statique
app.get(['/', '/index.html'], (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

/**
 * Route de contrôle de santé du serveur et des services (Health Check)
 */
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
        engine: `ANOR AI ${SERVER_VERSION}`,
        database,
        uptime: process.uptime(),
        memory: process.memoryUsage().rss,
        node: process.version
    });
});

/**
 * Route pour vérifier le statut d'un traitement en arrière-plan
 */
app.get('/api/seals/status/:jobId', (req, res) => {
    const { jobId } = req.params;
    if (!jobId || typeof jobId !== 'string' || jobId.length > 100) {
        return apiError(res, 400, "INVALID_JOB_ID", "Identifiant de tâche invalide.");
    }

    const job = taskQueue.getJobStatus(jobId);
    if (!job) {
        return apiError(res, 404, "JOB_NOT_FOUND", "Tâche introuvable.");
    }
    return apiSuccess(res, { job });
});

/**
 * Route unifiée pour la Forge ANOR (Asynchrone via Worker)
 */
app.post('/api/seals/generate-batch-seal', upload.fields([
    { name: 'certificat_pdf', maxCount: 1 },
    { name: 'visuel_produit', maxCount: 1 }
]), async (req, res) => {
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

        const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

        taskQueue.addJob(jobId, async () => {
            try {
                const certificateCode = `${lot}`;
                const smartPayload = AiBackendEngine.generateSmartMatrix(certificateCode);
                const imageBuffer = await SealRenderer.renderSealToBuffer(
                    smartPayload,
                    {
                        lot,
                        quantite,
                        type_emballage,
                        productName: nom_produit,
                        nom_produit,
                        nom_producteur,
                        isMasterSeal: true,
                        masterSerialLabel: `SÉRIE : DM / ${parseInt(quantite, 10).toLocaleString('fr-FR')}`
                    }
                );

                if (!isProduction) {
                    console.log("✔ Sceau généré");
                }

                if (!Buffer.isBuffer(imageBuffer)) {
                    throw new Error("Le renderer n'a pas renvoyé un Buffer valide.");
                }

                const rawBase64 = imageBuffer.toString("base64").replace(/\r|\n/g, "");

                let pdfUrl = null;
                let visuelUrl = null;

                if (req.files) {
                    const pdfFile = (req.files['certificat_pdf'] && req.files['certificat_pdf'][0]) 
                                 || (req.files['pdf'] && req.files['pdf'][0]);

                    if (pdfFile) {
                        try {
                            const pdfPath = `${Date.now()}_${pdfFile.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`;
                            const { data: pdfData, error: pdfErr } = await supabase.storage
                                .from('certificat-pdf')
                                .upload(pdfPath, pdfFile.buffer, { contentType: pdfFile.mimetype, upsert: true });

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
                            pdfUrl = `data:${pdfFile.mimetype};base64,${pdfFile.buffer.toString('base64')}`;
                        }
                    }

                    const visuelFile = (req.files['visuel_produit'] && req.files['visuel_produit'][0]) 
                                     || (req.files['visuel'] && req.files['visuel'][0])
                                     || (req.files['image'] && req.files['image'][0]);

                    if (visuelFile) {
                        try {
                            const visuelPath = `${Date.now()}_${visuelFile.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`;
                            const { data: visuelData, error: visuelErr } = await supabase.storage
                                .from('Produits')
                                .upload(visuelPath, visuelFile.buffer, { contentType: visuelFile.mimetype, upsert: true });

                            if (!visuelErr && visuelData) {
                                const { data: publicUrlData } = supabase.storage
                                    .from('Produits')
                                    .getPublicUrl(visuelPath);
                                visuelUrl = publicUrlData ? publicUrlData.publicUrl : null;
                            }
                        } catch (err) {
                            console.warn("⚠️ Exception Storage (Visuel) :", err.message);
                        }

                        if (!visuelUrl) {
                            visuelUrl = `data:${visuelFile.mimetype};base64,${visuelFile.buffer.toString('base64')}`;
                        }
                    }
                }

                const sha256_hash = smartPayload.aiSignature;
                const signature_ia = smartPayload.aiSignature;
                const engine_version = SERVER_VERSION;
                const statut = "CERTIFIÉ";

                const matrixHash = smartPayload.matrix 
                    ? crypto.createHash('sha256').update(JSON.stringify(smartPayload.matrix)).digest('hex')
                    : null;

                const payloadDB = {
                    certificate_code: certificateCode,
                    lot: lot,
                    quantite: parseInt(quantite, 10),
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
                    glyph_payload: smartPayload,
                    matrix_hash: matrixHash,
                    ai_signature_hash: smartPayload.aiSignature,
                    sha256_hash: sha256_hash,
                    signature_ia: signature_ia,
                    engine_version: engine_version,
                    statut: statut,
                    scan_count: 0
                };

                if (!isProduction) {
                    console.log("✔ Début écriture Supabase");
                }

                let { data, error } = await supabase
                    .from('produits_certifies')
                    .update(payloadDB)
                    .eq('lot', lot)
                    .select();

                if (!data || data.length === 0) {
                    const insertRes = await supabase
                        .from('produits_certifies')
                        .insert([payloadDB])
                        .select();
                    
                    data = insertRes.data;
                    error = insertRes.error;
                }

                if (error) throw error;

                if (!isProduction) {
                    console.log("✔ Écriture Supabase OK");
                }

                const printNoticeContent = 
`================================================================================
           AGENCE NATIONALE DE NORMALISATION ET DE QUALITÉ (ANOR)
              NOTICE D'INSTRUCTION TECHNIQUE ET D'IMPRESSION
================================================================================

DOCUMENT OFFICIEL DE SÉCURITÉ - À L'ATTENTION DE L'IMPRIMEUR ET DU FABRICANT
================================================================================

1. IDENTIFICATION DU LOT ET DU PRODUIT :
   - Numéro de Lot   : ${lot}
   - Nom du Produit : ${nom_produit || 'N/A'}
   - Producteur     : ${nom_producteur || 'N/A'}
   - Quantité certifiée : ${parseInt(quantite, 10).toLocaleString('fr-FR')} unités
   - Type d'emballage : ${type_emballage}

2. CONSIGNES TECHNIQUES D'IMPRESSION DU SCEAU :
   - Le fichier 'sceau_ANOR_MASTER.png' inclus dans ce paquet est la matrice Mère.
   - Impression recommandée : Quadrichromie haute résolution (300 DPI minimum).
   - Dimensions minimales du glyph central : 15mm x 15mm pour garantir la lecture par le scanner mobile.
   - Tolérance de décalage des micro-points : Max 0.05mm.
   - Ne pas altérer le ratio d'aspect (garder la matrice parfaitement carrée).

3. CONFORMITÉ ET SÉCURITÉ :
   - Ce sceau embarque la signature vectorielle de sécurité IA (${smartPayload.aiSignature}).
   - Toute altération géométrique ou tentative de reproduction par photocopie invalide 
     automatiquement l'authentification lors du contrôle sur le terrain par les agents ANOR.
   - En cas d'anomalie à l'impression, contacter immédiatement les services techniques d'ANOR.

--------------------------------------------------------------------------------
Fait à Yaoundé, le ${new Date().toLocaleDateString('fr-FR')}
Système Souverain de Certification - ANOR Engine ${SERVER_VERSION}
================================================================================`;

                const zip = new JSZip();
                zip.file("NOTICE_DIMPRESSION_ET_INSTRUCTIONS.txt", printNoticeContent);
                zip.file("certification.json", JSON.stringify({ 
                    lot, 
                    nom_produit, 
                    nom_producteur,
                    quantite: parseInt(quantite, 10), 
                    signature_ia: smartPayload.aiSignature,
                    created_at: new Date().toISOString() 
                }, null, 4));
                zip.file("sceau_ANOR_MASTER.png", imageBuffer);

                const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });

                if (!isProduction) {
                    console.log("✔ Fin de génération OK");
                }

                return {
                    success: true,
                    lot,
                    sha256_hash: smartPayload.aiSignature,
                    imageUrl: `data:image/png;base64,${rawBase64}`,
                    zipUrl: "data:application/zip;base64," + zipBuffer.toString("base64"),
                    data: data ? data[0] : null
                };

            } catch (err) {
                console.error(`❌ Erreur d'exécution de la tâche [${jobId}]:`, err);
                throw err;
            }
        });

        return apiSuccess(res, {
            message: "Génération en cours en arrière-plan.",
            jobId: jobId
        }, 202);

    } catch (error) {
        console.error("Erreur Forge Backend:", error);
        return apiError(res, 500, "FORGE_ERROR", error.message);
    }
});

// ==========================================
// 🛡️ SÉCURITÉ 2 : VÉRIFICATION DYNAMIQUE & DÉTECTION D'ANOMALIES
// ==========================================
app.post('/api/seals/verify', scanLimiter, async (req, res) => {
    const startTime = Date.now();
    const MAX_PROCESSING_TIME = 5000;

    try {
        // Validation du User-Agent
        if (!isValidUserAgent(req.headers["user-agent"])) {
            securityLog(req, "INVALID_USER_AGENT", { agent: req.headers["user-agent"] });
            return apiError(res, 400, "INVALID_CLIENT", "Client non valide.");
        }

        // Contrôle de la taille du payload
        const bodySize = Buffer.byteLength(JSON.stringify(req.body), "utf8");
        if (bodySize > 200000) {
            securityLog(req, "PAYLOAD_TOO_LARGE", { sizeBytes: bodySize });
            return apiError(res, 413, "PAYLOAD_TOO_LARGE", "Charge utile trop volumineuse.");
        }

        const { scannedMatrix, lot, location, locationMethod, deviceMetadata } = req.body;

        // Contrôle de présence de données
        if (!lot && !scannedMatrix) {
            return apiError(res, 400, "MISSING_SCAN", "Données de scan insuffisantes. Une matrice ou un lot est requis.");
        }

        // Validation de sécurité du lot
        if (lot && (typeof lot !== "string" || lot.length > 80)) {
            return apiError(res, 400, "INVALID_LOT", "Format de numéro de lot invalide.");
        }

        // Validation stricte de la matrice
        if (scannedMatrix && !isValidMatrix(scannedMatrix)) {
            return apiError(res, 400, "INVALID_MATRIX", "La matrice reçue est invalide.");
        }

        let row = null;
        const verificationMode = lot ? "LOT" : "MATRIX";

        // 1. Recherche prioritaire par Numéro de Lot
        if (lot) {
            const { data, error } = await supabase
                .from('produits_certifies')
                .select('*')
                .eq('lot', lot)
                .maybeSingle();

            if (!error && data) {
                row = data;
            }
        }

        // 2. Recherche alternative par Matrice
        if (!row && scannedMatrix) {
            const scannedHash = crypto.createHash('sha256').update(JSON.stringify(scannedMatrix)).digest('hex');

            const { data: candidates, error } = await supabase
                .from('produits_certifies')
                .select('lot,glyph_payload,matrix_hash')
                .limit(40);

            if (!error && candidates && candidates.length > 0) {
                let bestMatchLot = null;
                let highestScore = 0;

                for (const candidate of candidates) {
                    if (candidate.matrix_hash && candidate.matrix_hash === scannedHash) {
                        bestMatchLot = candidate.lot;
                        highestScore = 1.0;
                        break;
                    }

                    const storedPayload = candidate.glyph_payload;
                    const evalResult = AiBackendEngine.evaluateScanConfidence(
                        scannedMatrix, 
                        storedPayload ? storedPayload.matrix : []
                    );

                    if (evalResult.isValid && evalResult.confidence > highestScore) {
                        highestScore = evalResult.confidence;
                        bestMatchLot = candidate.lot;
                    }

                    if (highestScore >= 0.99) {
                        break;
                    }
                }

                if (bestMatchLot && highestScore >= 0.70) {
                    const { data: fullRow } = await supabase
                        .from('produits_certifies')
                        .select('*')
                        .eq('lot', bestMatchLot)
                        .maybeSingle();
                    
                    row = fullRow;
                }
            }
        }

        // Garde-fou de temps de traitement (Timeout)
        if (Date.now() - startTime > MAX_PROCESSING_TIME) {
            return apiError(res, 503, "TIMEOUT", "Temps maximal de traitement dépassé.");
        }

        // Sceau non trouvé dans la base
        if (!row) {
            return apiError(res, 404, "UNKNOWN_SEAL", "Sceau de lot inconnu ou contrefait.", {
                status: "CONTREFAÇON_REJETEE",
                processingTime: Date.now() - startTime,
                engineVersion: SERVER_VERSION,
                verificationMode: verificationMode
            });
        }

        // Évaluation par le moteur IA Backend
        const storedPayload = row.glyph_payload;
        const scannedHash = scannedMatrix ? crypto.createHash('sha256').update(JSON.stringify(scannedMatrix)).digest('hex') : null;
        let evaluation;

        if (scannedHash && row.matrix_hash && scannedHash === row.matrix_hash) {
            evaluation = { isValid: true, confidence: 1.0 };
        } else {
            evaluation = AiBackendEngine.evaluateScanConfidence(
                scannedMatrix || [], 
                storedPayload ? storedPayload.matrix : []
            );
        }

        // Rejet par l'IA
        if (!evaluation.isValid) {
            return apiError(res, 401, "INVALID_SEAL", "Alerte : Incohérence géométrique détectée par le moteur IA.", {
                status: "CONTREFAÇON_DETECTEE",
                confidence: evaluation.confidence,
                processingTime: Date.now() - startTime,
                engineVersion: SERVER_VERSION,
                verificationMode: verificationMode
            });
        }

        // Détection de duplication/clonage de sceau
        const currentScanCount = (row.scan_count || 0) + 1;
        const currentLocation = location || "Inconnue";
        let warningFlag = null;

        if (row.last_scan_location && row.last_scan_location !== currentLocation) {
            const timeDiffMinutes = (new Date() - new Date(row.last_scanned_at)) / (1000 * 60);
            if (timeDiffMinutes < 15) {
                warningFlag = "SUSPICION_DUPLICATION_SCEAU";
                securityLog(req, "SEAL_DUPLICATION", {
                    lot: row.lot,
                    previous: row.last_scan_location,
                    current: currentLocation
                });
            }
        }

        // Mise à jour de la télémétrie en arrière-plan
        supabase
            .from('produits_certifies')
            .update({ 
                scan_count: currentScanCount,
                last_scan_location: currentLocation,
                location_method: locationMethod || null,
                device_metadata: deviceMetadata || null,
                last_scanned_at: new Date()
            })
            .eq('lot', row.lot)
            .then(({ error: updateErr }) => {
                if (updateErr) console.error("⚠️ Erreur mise à jour télémétrie scan_count:", updateErr.message);
            });

        const confidenceScoreStr = (evaluation.confidence * 100).toFixed(1) + "%";

        return apiSuccess(res, {
            status: "AUTHENTIQUE",
            verified: true,
            confidence: evaluation.confidence,
            score: confidenceScoreStr,
            confidenceScore: evaluation.confidence,
            security_alert: warningFlag,
            securityAlert: warningFlag,
            lot: row.lot,
            batch: row.lot,
            nom_produit: row.nom_produit || "Produit Certifié Conforme",
            nomProduit: row.nom_produit || "Produit Certifié Conforme",
            nom_producteur: row.nom_producteur || "Producteur Agréé",
            nomProducteur: row.nom_producteur || "Producteur Agréé",
            pays: row.pays_origine || "Cameroun",
            pays_origine: row.pays_origine || "Cameroun",
            quantite: row.quantite,
            type_emballage: row.type_emballage,
            typeEmballage: row.type_emballage,
            visuel_produit_url: row.visuel_produit_url,
            visuelProduitUrl: row.visuel_produit_url,
            certificat_pdf_url: row.certificat_pdf_url,
            certificatPdfUrl: row.certificat_pdf_url,
            scan_count: currentScanCount,
            scanCount: currentScanCount,
            certified_at: row.created_at || row.date_certificat_conformite,
            certDate: row.date_certificat_conformite || row.created_at,
            prodDate: row.date_fabrication || "N/A",
            expDate: row.date_peremption || "N/A",
            norme: "ANOR NC-ISO",
            processingTime: Date.now() - startTime,
            processingTimeMs: Date.now() - startTime,
            engineVersion: SERVER_VERSION,
            verificationMode: verificationMode,
            serverTimestamp: Date.now()
        });

    } catch (error) {
        console.error("Erreur lors de la vérification:", error);
        return apiError(res, 500, "SERVER_ERROR", "Une erreur interne s'est produite lors de la vérification.");
    }
});

// ==========================================
// 🧠 TELEMETRIE TERRAIN & APPRENTISSAGE IA
// ==========================================
app.post('/api/seals/feedback', scanLimiter, async (req, res) => {
    try {
        const { lot, luminance, isLowLight, contrastScore, rawFrameSnippet } = req.body;

        if (!isProduction) {
            console.log(`🧠 [IA LEARNING] Télémétrie reçue pour Lot: ${lot || 'NON_SPÉCIFIÉ'} | Lumière: ${luminance} | Basse Lumière: ${isLowLight}`);
        }

        const safeSnippet = (rawFrameSnippet && typeof rawFrameSnippet === 'string') 
            ? rawFrameSnippet.substring(0, 500) 
            : null;

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

        const updatedThresholds = {
            recommendedLightBoost: !!isLowLight,
            adaptiveContrastMin: (typeof luminance === 'number' && luminance < 50) ? 0.35 : 0.50
        };

        return apiSuccess(res, {
            adaptiveParameters: updatedThresholds,
            message: "Télémétrie intégrée avec succès au modèle d'apprentissage."
        });

    } catch (err) {
        console.error("❌ Erreur Télémétrie IA:", err.message);
        return apiError(res, 500, "TELEMETRY_ERROR", "Échec d'enregistrement de la télémétrie.");
    }
});

/**
 * ======================================================
 * GESTIONNAIRE GLOBAL D'ERREURS EXPRESS
 * ======================================================
 */
app.use((err, req, res, next) => {
    console.error("[GLOBAL ERROR]", err);
    return apiError(
        res,
        500,
        "SERVER_ERROR",
        "Erreur interne du serveur."
    );
});

/**
 * ======================================================
 * PROTECTION DES ROUTES INCONNUES (404 Fallback)
 * ======================================================
 */
app.use((req, res) => {
    return apiError(
        res,
        404,
        "ROUTE_NOT_FOUND",
        "Route inexistante."
    );
});

// ==========================================
// 🚀 DEMARRAGE DU SERVEUR & SHUTDOWN PROPRE
// ==========================================
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`[EXPERT BACKEND] Serveur Souverain ANOR v${SERVER_VERSION} sécurisé prêt sur http://localhost:${PORT}`);
});

function shutdown(signal) {
    console.log(`${signal} reçu. Fermeture du serveur en cours...`);
    server.close(() => {
        console.log("Serveur arrêté proprement.");
        process.exit(0);
    });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));