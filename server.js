// ==========================================
// ANOR V16 • Serveur Backend Principal (API Forge & Indexation Haute Performance)
// ==========================================

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const svgToImg = require('svg-to-img'); // Conversion raster haute fidélité

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
const KITS_DIR = path.join(UPLOAD_DIR, 'kits');

[UPLOAD_DIR, CERT_DIR, VISUAL_DIR, KITS_DIR].forEach(dir => {
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
app.use('/uploads', express.static(UPLOAD_DIR));

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
// Moteur de Base de Données Haute Performance O(1) avec Persistance Fichier
// ==========================================
const DB_FILE = path.join(__dirname, 'database_registry.json');
const db = {
    registryMap: new Map(),
    fingerprintMap: new Map(),

    init() {
        try {
            if (fs.existsSync(DB_FILE)) {
                const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
                data.forEach(item => {
                    this.registryMap.set(item.identifiant, item);
                    if (item.empreinte_geometrique) {
                        this.fingerprintMap.set(item.empreinte_geometrique, item);
                    }
                });
                console.log(`[DB] ${this.registryMap.size} sceaux rechargés depuis le stockage persistant.`);
            }
        } catch (e) {
            console.error("[DB] Erreur lors du chargement de la base:", e.message);
        }
    },

    save() {
        try {
            const dataArray = Array.from(this.registryMap.values());
            fs.writeFileSync(DB_FILE, JSON.stringify(dataArray, null, 2));
        } catch (e) {
            console.error("[DB] Erreur lors de l'écriture en base:", e.message);
        }
    },

    insert(data) {
        this.registryMap.set(data.identifiant, data);
        if (data.empreinte_geometrique) {
            this.fingerprintMap.set(data.empreinte_geometrique, data);
        }
        this.save();
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

// Initialisation de la persistance au démarrage
db.init();

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

// Endpoint principal de la Forge : Capture intégrale des données de forge.html
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

        // 2. Appel du Compositeur officiel structuré sur grille
        const glyphes = Compositeur.composer(signature_maitre, { zoneSerie: true });

        // 3. Appel du GeometryIndex pour normaliser et calculer l'empreinte SHA-256 déterministe
        const indexGeo = GeometryIndex.build(glyphes);
        const empreinte_geometrique = indexGeo.sha256;

        // Optimisation compacte des notations
        const lotCompact = lot.replace(/mille/gi, 'M').replace(/III/g, '3').toUpperCase();

        // 4. Construction dynamique du rendu SVG fidèle aux spécifications géométriques
        const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="100%" height="100%">
            <defs>
                <linearGradient id="blueRing" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#0066FF" />
                    <stop offset="100%" stop-color="#003399" />
                </linearGradient>
                <path id="textPath" d="M -60,0 A 60,60 0 1,1 60,0 A 60,60 0 1,1 -60,0" fill="none"/>
            </defs>

            <!-- Anneau principal du sceau (Fond totalement transparent) -->
            <circle cx="250" cy="250" r="245" fill="none" stroke="url(#blueRing)" stroke-width="6"/>
            <circle cx="250" cy="250" r="230" fill="none" stroke="#0066FF" stroke-width="1.2" stroke-dasharray="4,6" opacity="0.5"/>

            <!-- Rendu structuré des glyphes géométriques -->
            <g id="glyphes-layer">
                ${glyphes.map(g => {
                    const x = 250 + g.rayon * Math.cos(g.angle);
                    const y = 250 + g.rayon * Math.sin(g.angle);
                    const rot = (g.angle * 180) / Math.PI;
                    const strokeColor = "#0066FF";
                    const fillColor = g.plein ? "#0066FF" : "none";
                    const strokeWidth = g.plein ? 1 : 1.8;

                    if (g.forme === 'anchor_top') {
                        return `<polygon points="${x},${y-7} ${x-6},${y+5} ${x+6},${y+5}" fill="#0066FF" stroke="#FFFFFF" stroke-width="1"/>`;
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

            <!-- Médaillon Central officiel avec texte circulaire -->
            <g transform="translate(250, 250)">
                <circle cx="0" cy="0" r="78" fill="#000000" stroke="#0066FF" stroke-width="3"/>
                <text font-size="8" font-family="monospace" fill="#0066FF" font-weight="bold" letter-spacing="1.5">
                    <textPath href="#textPath" startOffset="50%" text-anchor="middle">ANOR CERTIFIED • OFFICIAL SEAL •</textPath>
                </text>
                <circle cx="0" cy="0" r="42" fill="#FFFFFF" fill-opacity="0.08" stroke="#0066FF" stroke-width="2"/>
                <text x="0" y="6" font-size="24" font-family="monospace" fill="#FFFFFF" font-weight="bold" text-anchor="middle">NC</text>
            </g>

            <!-- Zone d'identification réglementaire sud -->
            <g transform="translate(250, 395)">
                <rect x="-130" y="0" width="260" height="34" rx="6" fill="#000000" fill-opacity="0.85" stroke="#0066FF" stroke-width="1.5"/>
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

        // Génération automatique du Kit de certification complet
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
            message: "Sceau forgé et enregistré avec succès en base de données.",
            identifiant,
            empreinte_geometrique,
            signature_maitre,
            pdf_url,
            visuel_url,
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

// Endpoint pour le téléchargement direct du Sceau en PNG Haute Définition (HD)
app.get('/api/forge/png/:identifiant', async (req, res) => {
    const { identifiant } = req.params;
    const record = db.findByIdentifiant(identifiant);

    if (!record || !record.svg) {
        return res.status(404).send("Sceau introuvable ou non généré.");
    }

    try {
        const pngBuffer = await svgToImg.from(record.svg).toPng({ scale: 2 });
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename="SCEAU_${identifiant}_HD.png"`);
        return res.send(pngBuffer);
    } catch (conversionError) {
        console.warn("Erreur conversion raster HD, repli SVG :", conversionError.message);
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Content-Disposition', `attachment; filename="SCEAU_${identifiant}.svg"`);
        return res.send(record.svg);
    }
});

// Endpoint pour télécharger le Kit de certification complet (ZIP ou dossier structuré)
app.get('/api/forge/kit/download/:identifiant', async (req, res) => {
    const { identifiant } = req.params;
    const record = db.findByIdentifiant(identifiant);

    if (!record) {
        return res.status(404).json({ success: false, message: "Enregistrement introuvable pour ce kit." });
    }

    try {
        // Génération ou récupération des données du kit enrichies
        let kitData = record;
        if (typeof KitGeneratorService.getKitData === 'function') {
            kitData = await KitGeneratorService.getKitData(record);
        }

        // Si un fichier ZIP de kit a été généré par le service
        if (record.kit_path && fs.existsSync(record.kit_path)) {
            return res.download(record.kit_path);
        }

        // Fallback propre : création dynamique d'un fichier JSON complet du kit téléchargeable
        const kitFilePath = path.join(KITS_DIR, `KIT_${identifiant}.json`);
        fs.writeFileSync(kitFilePath, JSON.stringify(kitData, null, 2), 'utf8');

        return res.download(kitFilePath, `KIT_CERTIFICATION_${identifiant}.json`);
    } catch (e) {
        console.error("Erreur téléchargement kit :", e.message);
        return res.status(500).json({ success: false, message: "Erreur lors de la préparation du kit.", error: e.message });
    }
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
    console.log(`[ANOR-V16] Serveur opérationnel sur le port ${PORT} avec le Compositeur géométrique structuré.`);
});