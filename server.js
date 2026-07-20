// ==========================================
// ANOR V16 • Serveur Backend Principal (API Forge & PNG Direct)
// ==========================================

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const Compositeur = require('./public/forge/compositeur');
const GeometryIndex = require('./core/geometryIndex');
const KitGeneratorService = require('./services/kitGeneratorService');

const app = express();
const PORT = process.env.PORT || 10000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const CERT_DIR = path.join(UPLOAD_DIR, 'certificates');
const VISUAL_DIR = path.join(UPLOAD_DIR, 'visuals');

[UPLOAD_DIR, CERT_DIR, VISUAL_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

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

    count() {
        return this.registryMap.size;
    }
};

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
                message: "Champs obligatoires manquants."
            });
        }

        const files = req.files || {};
        const certificatFile = files['certificat_pdf'] ? files['certificat_pdf'][0] : null;
        const visuelFile = files['visuel'] ? files['visuel'][0] : null;

        const pdf_url = certificatFile ? `/uploads/certificates/${certificatFile.filename}` : null;
        const visuel_url = visuelFile ? `/uploads/visuals/${visuelFile.filename}` : null;

        const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
        const identifiant = `ANOR-${new Date().getFullYear()}-${randomHex}`;

        const signature_maitre = crypto.createHmac('sha256', 'ANOR_MASTER_SECRET_KEY_V16')
            .update(`${identifiant}|${lot}|${pays_origine}`)
            .digest('hex');

        const glyphes = Compositeur.composer(signature_maitre, { zoneSerie: true });
        const indexGeo = GeometryIndex.build(glyphes);
        const empreinte_geometrique = indexGeo.sha256;

        const lotCompact = lot.replace(/mille/gi, 'M').replace(/III/g, '3').toUpperCase();

        // Génération du SVG de haute précision géométrique pour conversion PNG
        const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="500" height="500">
            <rect width="500" height="500" fill="#ffffff"/>
            <circle cx="250" cy="250" r="240" fill="none" stroke="#0055ff" stroke-width="5"/>
            <circle cx="250" cy="250" r="220" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="4,6"/>
            
            <!-- Triangle de repérage à 12H -->
            <polygon points="250,10 242,26 258,26" fill="#0055ff"/>

            <g id="glyphes-layer">
                ${glyphes.map(g => {
                    const x = 250 + g.rayon * Math.cos(g.angle);
                    const y = 250 + g.rayon * Math.sin(g.angle);
                    const rot = (g.angle * 180) / Math.PI + 90;
                    const strokeColor = "#0055ff";
                    const fillColor = g.plein ? "#0055ff" : "none";
                    const strokeWidth = 1.5;

                    if (g.forme === 'anchor_start') return '';
                    if (g.forme === 'rect_long') {
                        return `<rect x="${x - 12}" y="${y - 3}" width="24" height="6" rx="1" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" transform="rotate(${rot} ${x} ${y})" />`;
                    } else if (g.forme === 'rect_court') {
                        return `<rect x="${x - 7}" y="${y - 2.5}" width="14" height="5" rx="1" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" transform="rotate(${rot} ${x} ${y})" />`;
                    } else if (g.forme === 'circle') {
                        return `<circle cx="${x}" cy="${y}" r="4" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>`;
                    } else if (g.forme === 'diamond') {
                        return `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" transform="rotate(45 ${x} ${y})" />`;
                    } else {
                        return `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />`;
                    }
                }).join('')}
            </g>

            <g transform="translate(250, 250)">
                <circle cx="0" cy="0" r="65" fill="#ffffff" stroke="#0055ff" stroke-width="3"/>
                <text x="0" y="-8" fill="#0055ff" font-size="14" font-family="monospace" font-weight="bold" text-anchor="middle">ANOR</text>
                <text x="0" y="10" fill="#1e293b" font-size="10" font-family="monospace" text-anchor="middle">OFFICIAL</text>
            </g>

            <g transform="translate(250, 390)">
                <rect x="-130" y="0" width="260" height="36" rx="6" fill="#0f172a" stroke="#0055ff" stroke-width="1.5"/>
                <text x="0" y="13" fill="#3b82f6" font-size="10" font-family="monospace" font-weight="bold" text-anchor="middle">LOT : ${lotCompact} | ${pays_origine.toUpperCase()}</text>
                <text x="0" y="26" fill="#ffffff" font-size="9" font-family="monospace" text-anchor="middle">ID: ${identifiant} • SECURE</text>
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
            pdf_url,      
            visuel_url,
            empreinte_geometrique,
            signature_maitre,
            svg,          
            version: "ANOR-V16",
            created_at: new Date().toISOString()
        };

        db.insert(nouveauDossier);

        return res.status(200).json({
            success: true,
            message: "Sceau forgé avec succès.",
            identifiant,
            empreinte_geometrique,
            signature_maitre,
            svg,
            version: "ANOR-V16"
        });

    } catch (error) {
        console.error("Erreur critique dans /api/forge :", error);
        return res.status(500).json({
            success: false,
            message: "Erreur interne du serveur.",
            error: error.message
        });
    }
});

// Endpoint critique : Téléchargement direct d'un VRAI fichier PNG bitmap
app.get('/api/forge/png/:identifiant', async (req, res) => {
    const { identifiant } = req.params;
    const record = db.findByIdentifiant(identifiant);

    if (!record || !record.svg) {
        return res.status(404).send("Sceau introuvable.");
    }

    try {
        const sharp = require('sharp');
        const pngBuffer = await sharp(Buffer.from(record.svg))
            .png()
            .toBuffer();

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename="SCEAU_${identifiant}.png"`);
        return res.send(pngBuffer);
    } catch (err) {
        // Fallback propre si sharp n'est pas compilé sur l'environnement distant
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Content-Disposition', `attachment; filename="SCEAU_${identifiant}.svg"`);
        return res.send(record.svg);
    }
});

app.listen(PORT, () => {
    console.log(`[ANOR-V16] Serveur opérationnel sur le port ${PORT}`);
});