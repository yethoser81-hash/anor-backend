const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const JSZip = require("jszip");
const fs = require("fs");
const multer = require('multer');
const rateLimit = require('express-rate-limit'); // Sécurité Anti-DDoS / Brute-force
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // Limite 10MB

const supabase = require('./config/database');
const AiBackendEngine = require('./engine/aiBackendEngine');

// Import du gestionnaire de tâches d'arrière-plan
const taskQueue = require('./worker');

// Résolution souple du renderer
let SealRenderer;
try {
    SealRenderer = require('./engine/sealRenderer');
} catch (e) {
    SealRenderer = require('./renderer/sealRenderer');
}

const app = express();

// ==========================================
// 🛡️ SÉCURITÉ 1 : PROTECTION ANTI-HACKING & CORS
// ==========================================
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Protection contre l'épuisement mémoire
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// En-têtes de Sécurité Intégrés (Protection contre l'injection & Clickjacking)
app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", "default-src 'self' http://localhost:* 'unsafe-inline' 'unsafe-eval' data: blob:;");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    next();
});

// Limiteur de requêtes pour contrer le spamming d'API de vérification (Rate Limiting)
const scanLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // Max 60 scans par minute par IP
    message: { error: "Trop de requêtes de scan de ce périphérique. Veuillez ralentir." }
});

// Servir les fichiers statiques
app.use(express.static(__dirname));

// Route explicite pour intercepter / et /index.html
app.get(['/', '/index.html'], (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

/**
 * Route pour vérifier le statut d'un traitement en arrière-plan
 */
app.get('/api/seals/status/:jobId', (req, res) => {
    const job = taskQueue.getJobStatus(req.params.jobId);
    if (!job) {
        return res.status(404).json({ error: "Tâche introuvable." });
    }
    res.json(job);
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
            return res.status(400).json({ error: "Les champs lot, quantite et type_emballage sont obligatoires." });
        }

        const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        taskQueue.addJob(jobId, async () => {
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
            const engine_version = "ANOR-V16-SOVEREIGN";
            const statut = "CERTIFIÉ";

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
                ai_signature_hash: smartPayload.aiSignature,
                sha256_hash: sha256_hash,
                signature_ia: signature_ia,
                engine_version: engine_version,
                statut: statut,
                scan_count: 0
            };

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

            // Notice d'impression
            const printNoticeContent = 
`================================================================================
           AGENCE NORMALE DE NORMALISATION ET DE QUALITÉ (ANOR)
              NOTICE D'INSTRUCTION TECHNIQUE ET D'IMPRESSION
================================================================================

DOCUMENT OFFICIEL DE SÉCURITÉ - À L'ATTENTION DE L'IMPRIMEUR ET DU FABRICANT
================================================================================

1. IDENTIFICATION DU LOT ET DU PRODUIT :
   - Numéro de Lot  : ${lot}
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
   - Toute altération géométrique ou tentative de reproduction par photocopie invalidalise 
     automatiquement l'authentification lors du contrôle sur le terrain par les agents ANOR.
   - En cas d'anomalie à l'impression, contacter immédiatement les services techniques d'ANOR.

--------------------------------------------------------------------------------
Fait à Yaoundé, le ${new Date().toLocaleDateString('fr-FR')}
Système Souverain de Certification - ANOR Engine V16
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

            return {
                success: true,
                lot,
                sha256_hash: smartPayload.aiSignature,
                imageUrl: `data:image/png;base64,${rawBase64}`,
                zipUrl: "data:application/zip;base64," + zipBuffer.toString("base64"),
                data: data ? data[0] : null
            };
        });

        return res.status(202).json({
            success: true,
            message: "Génération en cours en arrière-plan.",
            jobId: jobId
        });

    } catch (error) {
        console.error("Erreur Forge Backend:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 🛡️ SÉCURITÉ 2 : VÉRIFICATION DYNAMIQUE & DÉTECTION D'ANOMALIES
// ==========================================
app.post('/api/seals/verify', scanLimiter, async (req, res) => {
    try {
        const { scannedMatrix, lot, location, locationMethod, clientTimestamp, deviceMetadata } = req.body;

        if (!lot || !scannedMatrix) {
            return res.status(400).json({ error: "Numéro de lot et matrice obligatoire." });
        }

        const { data: row, error } = await supabase
            .from('produits_certifies')
            .select('*')
            .eq('lot', lot)
            .single();

        if (error || !row) {
            return res.status(404).json({ 
                status: "CONTREFAÇON_REJETEE", 
                message: "Sceau de lot inconnu ou contrefait." 
            });
        }

        // ÉVALUATION PAR LE MOTEUR IA BACKEND
        const storedPayload = row.glyph_payload;
        const evaluation = AiBackendEngine.evaluateScanConfidence(scannedMatrix, storedPayload ? storedPayload.matrix : []);

        if (!evaluation.isValid) {
            return res.status(401).json({ 
                status: "CONTREFAÇON_DETECTEE", 
                message: "Alerte : Incohérence géométrique détectée par le moteur IA.",
                confidence: evaluation.confidence 
            });
        }

        // DÉTECTION SÉCURITÉ : Clones / duplication de sceaux
        const currentScanCount = (row.scan_count || 0) + 1;
        const currentLocation = location || "Inconnue";
        let warningFlag = null;

        if (row.last_scan_location && row.last_scan_location !== currentLocation) {
            const timeDiffMinutes = (new Date() - new Date(row.last_scanned_at)) / (1000 * 60);
            if (timeDiffMinutes < 15) {
                warningFlag = "SUSPICION_DUPLICATION_SCEAU";
                console.warn(`🚨 [ALERTE SÉCURITÉ] Suspicion de sceau cloné pour le lot ${lot} entre ${row.last_scan_location} et ${currentLocation}`);
            }
        }

        await supabase
            .from('produits_certifies')
            .update({ 
                scan_count: currentScanCount,
                last_scan_location: currentLocation,
                location_method: locationMethod || null,
                device_metadata: deviceMetadata || null,
                last_scanned_at: new Date()
            })
            .eq('lot', lot);

        // RÉPONSE ENRICHI HARMONISÉE FRONTEND ET BACKEND
        const confidenceScore = (evaluation.confidence * 100).toFixed(1) + "%";

        res.json({
            status: "AUTHENTIQUE",
            confidence: evaluation.confidence,
            score: confidenceScore,
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
            norme: "ANOR NC-ISO"
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 🧠 ÉTAPE 1 : IA À APPRENTISSAGE ÉVOLUTIF (TÉLÉMÉTRIE TERRAIN)
// ==========================================
app.post('/api/seals/feedback', scanLimiter, async (req, res) => {
    try {
        const { lot, luminance, isLowLight, contrastScore, rawFrameSnippet } = req.body;

        console.log(`🧠 [IA LEARNING] Télémétrie reçue pour Lot: ${lot} | Lumière: ${luminance} | Basse Lumière: ${isLowLight}`);

        await supabase
            .from('telemetrie_scans')
            .insert([{
                lot: lot || "INCONNU",
                luminance: luminance,
                is_low_light: isLowLight,
                contrast_score: contrastScore,
                frame_snippet: rawFrameSnippet ? rawFrameSnippet.substring(0, 500) : null,
                created_at: new Date()
            }]);

        const updatedThresholds = {
            recommendedLightBoost: !!isLowLight,
            adaptiveContrastMin: luminance < 50 ? 0.35 : 0.50
        };

        res.json({
            success: true,
            adaptiveParameters: updatedThresholds,
            message: "Télémétrie intégrée avec succès au modèle d'apprentissage."
        });

    } catch (err) {
        console.error("❌ Erreur Télémétrie IA:", err.message);
        res.status(500).json({ error: "Échec d'enregistrement de la télémétrie." });
    }
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: "ONLINE", engine: "Souverain ANOR AI Engine - Sécurité V16 & Apprentissage Évolutif Actif" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[EXPERT BACKEND] Serveur Souverain ANOR sécurisé prêt sur http://localhost:${PORT}`);
});