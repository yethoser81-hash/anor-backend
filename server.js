// ==========================================
// ANOR V16 • Serveur Backend Principal (API Forge & Indexation Haute Performance)
// ==========================================

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Importation de vos modules architecturaux validés
const Compositeur = require('./public/forge/compositeur');
const GeometryIndex = require('./core/geometryIndex');
const KitGeneratorService = require('./services/kitGeneratorService');

const app = express();
const PORT = process.env.PORT || 10000;

// Configuration des dossiers de stockage locaux
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const CERT_DIR = path.join(UPLOAD_DIR, 'certificates');
const VISUAL_DIR = path.join(UPLOAD_DIR, 'visuals');

[UPLOAD_DIR, CERT_DIR, VISUAL_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Configuration de Multer pour la gestion des fichiers multipart/form-data
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'certificat_pdf') {
            cb(null, CERT_DIR);
        } else if (file.fieldname === 'visuel') {
            cb(null, VISUAL_DIR);
        } else {
            cb(null, UPLOAD_DIR);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

// Middlewares globaux
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Gestion CORS basique
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// ==========================================
// Moteur de Base de Données Haute Performance O(1)
// ==========================================
const db = {
    registryMap: new Map(),
    fingerprintMap: new Map(),

    insert(data) {
        this.registryMap.set(data.identifiant, data);
        this.fingerprintMap.set(data.empreinte_geometrique, data);
        return data;
    },
    
    findByIdentifiant(id) {
        return this.registryMap.get(id) || null;
    },

    findByFingerprint(fingerprint) {
        return this.fingerprintMap.get(fingerprint) || null;
    },

    count() {
        return this.registryMap.size;
    }
};

// ==========================================
// ROUTES DE L'API ANOR V16
// ==========================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'forge.html'));
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ONLINE', 
        version: 'ANOR-V16', 
        total_sceaux_indexes: db.count(),
        timestamp: new Date().toISOString() 
    });
});

// Endpoint principal de la Forge : Utilise Compositeur et GeometryIndex
app.post('/api/forge', upload.fields([
    { name: 'certificat_pdf', maxCount: 1 },
    { name: 'visuel', maxCount: 1 }
]), async (req, res) => {
    try {
        const {
            nom_produit,
            nom_producteur,
            composition,
            lot,
            quantite,
            type_emballage,
            pays_origine,
            email_entreprise,
            date_certificat_conformite,
            date_fabrication,
            date_peremption
        } = req.body;

        if (!nom_produit || !nom_producteur || !lot || !pays_origine) {
            return res.status(400).json({
                success: false,
                message: "Champs obligatoires manquants (nom_produit, nom_producteur, lot, pays_origine)."
            });
        }

        const files = req.files || {};
        const certificatFile = files['certificat_pdf'] ? files['certificat_pdf'][0] : null;
        const visuelFile = files['visuel'] ? files['visuel'][0] : null;

        const pdf_url = certificatFile ? `/uploads/certificates/${certificatFile.filename}` : null;
        const visuel_url = visuelFile ? `/uploads/visuals/${visuelFile.filename}` : null;

        // Génération de l'identifiant unique ANOR
        const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
        const identifiant = `ANOR-${new Date().getFullYear()}-${randomHex}`;

        // 1. Génération de la signature maître sécurisée
        const signature_maitre = crypto.createHmac('sha256', 'ANOR_MASTER_SECRET_KEY_V16')
            .update(`${identifiant}|${lot}|${pays_origine}`)
            .digest('hex');

        // 2. Appel du Compositeur officiel pour générer les glyphes de la structure géométrique
        const glyphes = Compositeur.composer(signature_maitre, { zoneSerie: true });

        // 3. Appel du GeometryIndex pour normaliser et calculer l'empreinte SHA-256 déterministe
        const indexGeo = GeometryIndex.build(glyphes);
        const empreinte_geometrique = indexGeo.sha256;

        // Optimisation compacte des notations (ex: M et 3 pour éviter les débordements)
        const lotCompact = lot.replace(/mille/gi, 'M').replace(/III/g, '3').toUpperCase();

        // 4. Construction dynamique du rendu SVG (Fond totalement transparent, respect strict des tailles, formes variées pleines/vides, logo maître et zone encadrée non débordante)
        const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="100%" height="100%">
            <defs>
                <linearGradient id="blueRing" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#0066FF" />
                    <stop offset="100%" stop-color="#003399" />
                </linearGradient>
            </defs>

            <!-- Anneau principal du sceau (Fond totalement vide / transparent) -->
            <circle cx="250" cy="250" r="245" fill="none" stroke="url(#blueRing)" stroke-width="6"/>
            <circle cx="250" cy="250" r="230" fill="none" stroke="#0066FF" stroke-width="1.2" stroke-dasharray="4,6" opacity="0.5"/>

            <!-- Rendu dynamique des glyphes géométriques (alternance pleins/vides, rectangles longs et courts) -->
            <g id="glyphes-layer">
                ${glyphes.map(g => {
                    const x = 250 + g.rayon * Math.cos(g.angle);
                    const y = 250 + g.rayon * Math.sin(g.angle);
                    const rot = (g.angle * 180) / Math.PI;
                    const strokeColor = "#0066FF";
                    const fillColor = g.plein ? "#0066FF" : "none";
                    const strokeWidth = g.plein ? 1 : 1.8;

                    if (g.forme === 'anchor_start') {
                        // Point de départ de lecture positionné tout près du médaillon central
                        return `<circle cx="${x}" cy="${y}" r="5" fill="#0066FF" stroke="#FFFFFF" stroke-width="1.5"/>`;
                    } else if (g.forme === 'rect_long') {
                        return `<rect x="${x - 18}" y="${y - 4}" width="36" height="8" rx="2" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" transform="rotate(${rot} ${x} ${y})" />`;
                    } else if (g.forme === 'rect_court') {
                        return `<rect x="${x - 8}" y="${y - 3}" width="16" height="6" rx="1.5" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" transform="rotate(${rot} ${x} ${y})" />`;
                    } else if (g.forme === 'circle') {
                        return `<circle cx="${x}" cy="${y}" r="4.5" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>`;
                    } else if (g.forme === 'diamond') {
                        return `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" transform="rotate(45 ${x} ${y})" />`;
                    } else if (g.forme === 'plus') {
                        return `<text x="${x}" y="${y + 4}" font-size="12" fill="${strokeColor}" font-family="monospace" text-anchor="middle" font-weight="bold">+</text>`;
                    } else {
                        return `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" transform="rotate(${rot} ${x} ${y})" />`;
                    }
                }).join('')}
            </g>

            <!-- Médaillon Central officiel intégrant le logo maître public/assets/logo_anor_master.png -->
            <g transform="translate(250, 250)">
                <circle cx="0" cy="0" r="75" fill="#FFFFFF" fill-opacity="0.05" stroke="#0066FF" stroke-width="3"/>
                <image href="/assets/logo_anor_master.png" x="-55" y="-55" width="110" height="110" preserveAspectRatio="xMidYMid meet" />
            </g>

            <!-- Zone d'identification réglementaire strictement encapsulée à l'intérieur du cercle inférieur (sans débordement) -->
            <g transform="translate(250, 395)">
                <rect x="-130" y="0" width="260" height="34" rx="6" fill="#000000" fill-opacity="0.75" stroke="#0066FF" stroke-width="1.5"/>
                <text x="0" y="13" fill="#0066FF" font-size="9.5" font-family="monospace" font-weight="bold" text-anchor="middle">LOT : ${lotCompact} | ${pays_origine.toUpperCase()}</text>
                <text x="0" y="26" fill="#FFFFFF" font-size="8.5" font-family="monospace" text-anchor="middle">ID: ${identifiant} • SHA: ${empreinte_geometrique.substring(0, 12)}</text>
            </g>
        </svg>`;

        const nouveauDossier = {
            identifiant,
            nom_produit,
            nom_producteur,
            composition: composition || "",
            lot: lotCompact,
            quantite: parseInt(quantite) || 1,
            type_emballage: type_emballage || "",
            pays_origine,
            email_entreprise: email_entreprise || "",
            date_certificat_conformite: date_certificat_conformite || null,
            date_fabrication: date_fabrication || null,
            date_peremption: date_peremption || null,
            pdf_url,      
            visuel_url,
            empreinte_geometrique,
            signature_maitre,
            index_geometrique: indexGeo,
            svg,          
            version: "ANOR-V16",
            created_at: new Date().toISOString()
        };

        db.insert(nouveauDossier);

        // Intégration proactive de la génération automatique du kit via KitGeneratorService si disponible
        let kit_path = null;
        try {
            if (typeof KitGeneratorService.generateKit === 'function') {
                kit_path = await KitGeneratorService.generateKit(nouveauDossier);
            }
        } catch (kitErr) {
            console.warn("Avertissement génération du kit :", kitErr.message);
        }

        return res.status(200).json({
            success: true,
            message: "Sceau forgé avec succès via le compositeur géométrique.",
            identifiant,
            empreinte_geometrique,
            signature_maitre,
            pdf_url,
            kit_path,
            svg,
            version: "ANOR-V16"
        });

    } catch (error) {
        console.error("Erreur critique dans /api/forge :", error);
        return res.status(500).json({
            success: false,
            message: "Erreur interne du serveur lors de la forge.",
            error: error.message
        });
    }
});

// Endpoint pour le téléchargement direct de l'image PNG / SVG HD
app.get('/api/forge/png/:identifiant', (req, res) => {
    const { identifiant } = req.params;
    const record = db.findByIdentifiant(identifiant);

    if (!record || !record.svg) {
        return res.status(404).send("Sceau introuvable ou non généré.");
    }

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Content-Disposition', `attachment; filename="SCEAU_${identifiant}.svg"`);
    return res.send(record.svg);
});

// Endpoint pour la génération et récupération du kit de certification complet
app.get('/api/forge/kit/:identifiant', async (req, res) => {
    const { identifiant } = req.params;
    const record = db.findByIdentifiant(identifiant);

    if (!record) {
        return res.status(404).json({ success: false, message: "Kit introuvable." });
    }

    let kitData = {
        identifiant: record.identifiant,
        produit: record.nom_produit,
        producteur: record.nom_producteur,
        lot: record.lot,
        empreinte_geometrique: record.empreinte_geometrique,
        signature_maitre: record.signature_maitre,
        svg_source: record.svg
    };

    try {
        if (typeof KitGeneratorService.getKitData === 'function') {
            kitData = await KitGeneratorService.getKitData(record);
        }
    } catch (e) {
        console.warn("Utilisation du kit par défaut :", e.message);
    }

    return res.status(200).json({
        success: true,
        message: "Kit de certification récupéré avec succès.",
        kit: kitData
    });
});

app.get('/api/registry/:identifiant', (req, res) => {
    const { identifiant } = req.params;
    const record = db.findByIdentifiant(identifiant);

    if (!record) {
        return res.status(404).json({ success: false, message: "Enregistrement introuvable." });
    }

    return res.status(200).json({ success: true, data: record });
});

app.listen(PORT, () => {
    console.log(`[ANOR-V16] Serveur opérationnel sur le port ${PORT} avec le Compositeur géométrique actif.`);
});