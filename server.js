// ==========================================
// ANOR V16.5 • Serveur Backend Principal (API Forge & Indexation Haute Performance)
// ==========================================

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const svgToImg = require('svg-to-img'); // Conversion raster haute fidélité
const archiver = require('archiver'); // Génération des archives ZIP pour les kits

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
// ROUTES DE L'API ANOR V16.5
// ==========================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'forge.html'));
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ONLINE', 
        version: 'ANOR-V16.5', 
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
        const serialNumber = `SN-${randomHex}`;
        const shaCourt = empreinte_geometrique.substring(0, 16);

        // 4. Construction dynamique du rendu SVG officiel ANOR V16.5
        const svg = `
<svg
xmlns="http://www.w3.org/2000/svg"
viewBox="0 0 700 700"
width="700"
height="700">

<defs>

<linearGradient id="ringBlue" x1="0%" y1="0%" x2="100%" y2="100%">
<stop offset="0%" stop-color="#33AAFF"/>
<stop offset="100%" stop-color="#003399"/>
</linearGradient>

<linearGradient id="centerBlue" x1="0%" y1="0%" x2="0%" y2="100%">
<stop offset="0%" stop-color="#001B52"/>
<stop offset="100%" stop-color="#000000"/>
</linearGradient>

<filter id="shadow">
<feDropShadow
dx="0"
dy="0"
stdDeviation="4"
flood-color="#0066ff"
flood-opacity="0.55"/>
</filter>

<path
id="textTop"
d="
M 350 350
m -140 0
a 140 140 0 1 1 280 0
a 140 140 0 1 1 -280 0"
/>

<path
id="textBottom"
d="
M 350 350
m 140 0
a 140 140 0 1 0 -280 0
a 140 140 0 1 0 280 0"
/>

</defs>

<!-- ========================================================== -->
<!-- Anneau externe -->
<!-- ========================================================== -->

<circle
cx="350"
cy="350"
r="335"
fill="none"
stroke="url(#ringBlue)"
stroke-width="6"/>

<circle
cx="350"
cy="350"
r="322"
fill="none"
stroke="#0A6EFF"
stroke-width="2"/>

<circle
cx="350"
cy="350"
r="304"
fill="none"
stroke="#0A6EFF"
stroke-dasharray="6 8"
stroke-width="1"/>

<!-- ========================================================== -->
<!-- GLYPHES -->
<!-- ========================================================== -->

<g
id="glyph-layer"
filter="url(#shadow)">

${glyphes.map(g => {
    const x = 350 + g.rayon * Math.cos(g.angle);
    const y = 350 + g.rayon * Math.sin(g.angle);
    const rot = ((g.rotation || g.angle) * 180 / Math.PI);
    const scale = g.scale || 1;
    const stroke = "#0A6EFF";
    const fill = g.plein ? "#0A6EFF" : "none";

    switch(g.forme) {
        case "anchor_top":
            return `<polygon points="${x},${y-11} ${x-9},${y+8} ${x+9},${y+8}" fill="#0A6EFF" stroke="#FFFFFF" stroke-width="2"/>`;
        case "rect_long":
            return `<rect x="${x-18*scale}" y="${y-4*scale}" width="${36*scale}" height="${8*scale}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1.5" transform="rotate(${rot} ${x} ${y})"/>`;
        case "rect_court":
            return `<rect x="${x-10*scale}" y="${y-4*scale}" width="${20*scale}" height="${8*scale}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1.5" transform="rotate(${rot} ${x} ${y})"/>`;
        case "square":
            return `<rect x="${x-6*scale}" y="${y-6*scale}" width="${12*scale}" height="${12*scale}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" transform="rotate(${rot} ${x} ${y})"/>`;
        case "diamond":
            return `<rect x="${x-6*scale}" y="${y-6*scale}" width="${12*scale}" height="${12*scale}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" transform="rotate(45 ${x} ${y})"/>`;
        case "circle":
            return `<circle cx="${x}" cy="${y}" r="${4.8*scale}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
        case "double_circle":
            return `<circle cx="${x}" cy="${y}" r="${5*scale}" fill="none" stroke="${stroke}" stroke-width="1.5"/><circle cx="${x}" cy="${y}" r="${2.4*scale}" fill="${stroke}"/>`;
        case "triangle":
            return `<polygon points="${x},${y-7*scale} ${x+6*scale},${y+6*scale} ${x-6*scale},${y+6*scale}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" transform="rotate(${rot} ${x} ${y})"/>`;
        case "triangle_inverse":
            return `<polygon points="${x},${y+7*scale} ${x+6*scale},${y-6*scale} ${x-6*scale},${y-6*scale}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" transform="rotate(${rot} ${x} ${y})"/>`;
        case "hexagon":
            return `<polygon points="${x},${y-6*scale} ${x+5*scale},${y-3*scale} ${x+5*scale},${y+3*scale} ${x},${y+6*scale} ${x-5*scale},${y+3*scale} ${x-5*scale},${y-3*scale}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" transform="rotate(${rot} ${x} ${y})"/>`;
        case "cross":
            return `<line x1="${x-5*scale}" y1="${y-5*scale}" x2="${x+5*scale}" y2="${y+5*scale}" stroke="${stroke}" stroke-width="2"/><line x1="${x+5*scale}" y1="${y-5*scale}" x2="${x-5*scale}" y2="${y+5*scale}" stroke="${stroke}" stroke-width="2"/>`;
        case "plus":
            return `<line x1="${x}" y1="${y-5*scale}" x2="${x}" y2="${y+5*scale}" stroke="${stroke}" stroke-width="2"/><line x1="${x-5*scale}" y1="${y}" x2="${x+5*scale}" y2="${y}" stroke="${stroke}" stroke-width="2"/>`;
        case "bar_vertical":
            return `<rect x="${x-2}" y="${y-8*scale}" width="4" height="${16*scale}" fill="${stroke}" transform="rotate(${rot} ${x} ${y})"/>`;
        case "bar_horizontal":
            return `<rect x="${x-8*scale}" y="${y-2}" width="${16*scale}" height="4" fill="${stroke}" transform="rotate(${rot} ${x} ${y})"/>`;
        case "chevron":
            return `<polyline points="${x-6*scale},${y-3*scale} ${x},${y+4*scale} ${x+6*scale},${y-3*scale}" fill="none" stroke="${stroke}" stroke-width="2" transform="rotate(${rot} ${x} ${y})"/>`;
        case "arc":
            return `<path d="M ${x-5*scale} ${y} A ${5*scale} ${5*scale} 0 0 1 ${x+5*scale} ${y}" fill="none" stroke="${stroke}" stroke-width="2" transform="rotate(${rot} ${x} ${y})"/>`;
        default:
            return "";
    }
}).join("")}

</g>

<!-- ========================================================== -->
<!-- LOGO CENTRAL -->
<!-- ========================================================== -->

<g transform="translate(350 350)">
<circle r="92" fill="url(#centerBlue)" stroke="#0A6EFF" stroke-width="4"/>
<circle r="76" fill="none" stroke="#0A6EFF" stroke-width="2"/>
<circle r="60" fill="#081B3A" stroke="#0A6EFF" stroke-width="1"/>

<text x="0" y="-8" fill="#FFFFFF" font-size="34" font-family="Arial" font-weight="bold" text-anchor="middle">NC</text>
<text x="0" y="22" fill="#6EC1FF" font-size="13" font-family="Arial" font-weight="bold" text-anchor="middle">CERTIFIED</text>
</g>

<!-- ========================================================== -->
<!-- TEXTE CIRCULAIRE -->
<!-- ========================================================== -->

<text font-size="12" fill="#0A6EFF" font-family="Arial" font-weight="bold" letter-spacing="2">
<textPath href="#textTop" startOffset="50%" text-anchor="middle">ANOR • NATIONAL CERTIFICATION • OFFICIAL SEAL •</textPath>
</text>

<text font-size="11" fill="#0A6EFF" font-family="Arial" font-weight="bold" letter-spacing="2">
<textPath href="#textBottom" startOffset="50%" text-anchor="middle">SECURITY • AUTHENTICITY • TRACEABILITY •</textPath>
</text>

<!-- ========================================================== -->
<!-- CARTOUCHE SERIALISATION -->
<!-- ========================================================== -->

<g transform="translate(350 585)">
<rect x="-210" y="0" width="420" height="78" rx="12" fill="#020202" stroke="#0A6EFF" stroke-width="2"/>
<line x1="-70" y1="0" x2="-70" y2="78" stroke="#0A6EFF"/>
<line x1="70" y1="0" x2="70" y2="78" stroke="#0A6EFF"/>

<text x="-140" y="24" fill="#6EC1FF" font-size="12" font-family="monospace" text-anchor="middle">LOT</text>
<text x="-140" y="48" fill="#FFFFFF" font-size="14" font-family="monospace" font-weight="bold" text-anchor="middle">${lotCompact}</text>

<text x="0" y="24" fill="#6EC1FF" font-size="12" font-family="monospace" text-anchor="middle">SERIAL</text>
<text x="0" y="48" fill="#FFFFFF" font-size="14" font-family="monospace" font-weight="bold" text-anchor="middle">${serialNumber}</text>

<text x="140" y="24" fill="#6EC1FF" font-size="12" font-family="monospace" text-anchor="middle">ID</text>
<text x="140" y="48" fill="#FFFFFF" font-size="11" font-family="monospace" font-weight="bold" text-anchor="middle">${identifiant}</text>

<text x="0" y="68" fill="#7FD6FF" font-size="10" font-family="monospace" text-anchor="middle">SHA256 : ${shaCourt}</text>
</g>

</svg>
`;

        // ==========================================================
        // Génération automatique du Kit ANOR V16.5
        // ZIP + PNG HD + SVG + METADATA + SHA
        // ==========================================================
        let kit_path = null;
        try {
            const kitFolder = path.join(KITS_DIR, `KIT_${identifiant}`);
            if (!fs.existsSync(kitFolder)) {
                fs.mkdirSync(kitFolder, { recursive: true });
            }

            // SVG officiel
            const svgPath = path.join(kitFolder, `SCEAU_${identifiant}.svg`);
            fs.writeFileSync(svgPath, svg, 'utf8');

            // PNG HD
            const pngPath = path.join(kitFolder, `SCEAU_${identifiant}_HD.png`);
            try {
                const pngBuffer = await svgToImg.from(svg).toPng({
                    width: 3000,
                    height: 3000
                });
                fs.writeFileSync(pngPath, pngBuffer);
            } catch (pngError) {
                console.warn("PNG kit non généré:", pngError.message);
            }

            // Metadata
            const kitMetadata = {
                identifiant,
                nom_produit,
                nom_producteur,
                lot: lotCompact,
                pays_origine,
                quantite,
                empreinte_geometrique,
                signature_maitre,
                version: "ANOR-V16.5",
                created_at: new Date().toISOString()
            };

            fs.writeFileSync(
                path.join(kitFolder, "metadata.json"),
                JSON.stringify(kitMetadata, null, 2),
                "utf8"
            );

            // Signature
            fs.writeFileSync(
                path.join(kitFolder, "signature.sha256"),
                empreinte_geometrique,
                "utf8"
            );

            // ZIP
            const zipPath = path.join(KITS_DIR, `KIT_CERTIFICATION_${identifiant}.zip`);
            const output = fs.createWriteStream(zipPath);
            const archive = require('archiver')('zip', {
                zlib: { level: 9 }
            });

            archive.pipe(output);
            archive.directory(kitFolder, false);
            await archive.finalize();

            kit_path = zipPath;

        } catch (kitError) {
            console.warn("Erreur génération kit:", kitError.message);
        }

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
            kit_path,
            numero_serie: serialNumber,
            version: "ANOR-V16.5",
            created_at: new Date().toISOString()
        };

        db.insert(nouveauDossier);

        return res.status(200).json({
            success: true,
            message: "Sceau forgé (v16.5) et enregistré avec succès en base de données.",
            identifiant,
            empreinte_geometrique,
            signature_maitre,
            pdf_url,
            visuel_url,
            svg,
            version: "ANOR-V16.5",
            numero_serie: serialNumber,
            kit_download: `/api/forge/kit/download/${identifiant}`,
            png_download: `/api/forge/png/${identifiant}`
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

// ==========================================================
// EXPORT PNG HD ANOR V16.5
// PNG haute résolution 3000x3000
// ==========================================================
app.get('/api/forge/png/:identifiant', async (req, res) => {
    const { identifiant } = req.params;
    const record = db.findByIdentifiant(identifiant);

    if (!record || !record.svg) {
        return res.status(404).send("Sceau introuvable.");
    }

    try {
        const pngBuffer = await svgToImg.from(record.svg).toPng({
            width: 3000,
            height: 3000
        });

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename="ANOR_${identifiant}_HD.png"`);
        return res.send(pngBuffer);

    } catch (error) {
        console.error("Erreur PNG HD:", error.message);
        res.setHeader('Content-Type', 'image/svg+xml');
        return res.send(record.svg);
    }
});

// ==========================================================
// KIT CERTIFICATION COMPLET ANOR V16.5
// ==========================================================
app.get('/api/forge/kit/download/:identifiant', async (req, res) => {
    const { identifiant } = req.params;
    const record = db.findByIdentifiant(identifiant);

    if (!record) {
        return res.status(404).json({
            success: false,
            message: "Sceau inconnu"
        });
    }

    try {
        const kitFolder = path.join(KITS_DIR, `KIT_${identifiant}`);
        if (!fs.existsSync(kitFolder)) {
            fs.mkdirSync(kitFolder, { recursive: true });
        }

        // ----------------------------------------------------------
        // SVG ORIGINAL
        // ----------------------------------------------------------
        fs.writeFileSync(path.join(kitFolder, `SCEAU_${identifiant}.svg`), record.svg, 'utf8');

        // ----------------------------------------------------------
        // PNG HD
        // ----------------------------------------------------------
        try {
            const png = await svgToImg.from(record.svg).toPng({
                width: 3000,
                height: 3000
            });
            fs.writeFileSync(path.join(kitFolder, `SCEAU_${identifiant}_HD.png`), png);
        } catch (e) {
            console.warn("PNG kit impossible:", e.message);
        }

        // ----------------------------------------------------------
        // METADATA JSON
        // ----------------------------------------------------------
        const metadata = {
            identifiant: record.identifiant,
            produit: record.nom_produit,
            producteur: record.nom_producteur,
            lot: record.lot,
            pays: record.pays_origine,
            composition: record.composition,
            empreinte_geometrique: record.empreinte_geometrique,
            signature_maitre: record.signature_maitre,
            version: record.version,
            date_creation: record.created_at
        };
        fs.writeFileSync(path.join(kitFolder, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');

        // ----------------------------------------------------------
        // SIGNATURE SHA
        // ----------------------------------------------------------
        fs.writeFileSync(path.join(kitFolder, 'SIGNATURE.sha256'), record.empreinte_geometrique, 'utf8');

        // ----------------------------------------------------------
        // INDEX GEOMETRIQUE
        // ----------------------------------------------------------
        fs.writeFileSync(path.join(kitFolder, 'geometry_index.json'), JSON.stringify(record.index_geometrique, null, 2), 'utf8');

        // ----------------------------------------------------------
        // CERTIFICAT ORIGINAL
        // ----------------------------------------------------------
        if (record.pdf_url) {
            const sourcePDF = path.join(__dirname, record.pdf_url);
            if (fs.existsSync(sourcePDF)) {
                fs.copyFileSync(sourcePDF, path.join(kitFolder, 'CERTIFICAT_ORIGINAL.pdf'));
            }
        }

        // ----------------------------------------------------------
        // VISUEL PRODUIT
        // ----------------------------------------------------------
        if (record.visuel_url) {
            const sourceImage = path.join(__dirname, record.visuel_url);
            if (fs.existsSync(sourceImage)) {
                fs.copyFileSync(sourceImage, path.join(kitFolder, 'VISUEL_PRODUIT'));
            }
        }

        // ----------------------------------------------------------
        // ZIP FINAL
        // ----------------------------------------------------------
        const zipPath = path.join(KITS_DIR, `KIT_CERTIFICATION_${identifiant}.zip`);
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', {
            zlib: { level: 9 }
        });

        output.on('close', () => {
            return res.download(zipPath, `KIT_CERTIFICATION_${identifiant}.zip`);
        });

        archive.on('error', (err) => {
            throw err;
        });

        archive.pipe(output);
        archive.directory(kitFolder, false);
        await archive.finalize();

    } catch (error) {
        console.error("Erreur génération kit:", error);
        return res.status(500).json({
            success: false,
            message: "Erreur création kit",
            error: error.message
        });
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
    console.log(`[ANOR-V16.5] Serveur opérationnel sur le port ${PORT} avec routes PNG HD et Kit de certification ZIP.`);
});