// ==========================================
// ANOR V16 • Serveur Backend Principal (API Forge & Indexation Haute Performance)
// ==========================================

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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
    limits: { fileSize: 10 * 1024 * 1024 } // Limite à 10 Mo par fichier
});

// Middlewares globaux
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
// Conçu pour encaisser des millions de sceaux sans latence.
// ==========================================
const db = {
    // Index principal par identifiant (Complexité O(1) pour l'accès direct)
    registryMap: new Map(),
    
    // Index secondaire par empreinte géométrique (pour la recherche inversée ultra-rapide)
    fingerprintMap: new Map(),

    insert(data) {
        // Enregistrement dans les tables de hachage indexées
        this.registryMap.set(data.identifiant, data);
        this.fingerprintMap.set(data.empreinte_geometrique, data);
        return data;
    },
    
    findByIdentifiant(id) {
        // Recherche à temps constant O(1) via la clé de hachage
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

// Route de test de santé du serveur
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ONLINE', 
        version: 'ANOR-V16', 
        total_sceaux_indexes: db.count(),
        timestamp: new Date().toISOString() 
    });
});

// Endpoint principal de la Forge : Traitement du formulaire, génération du sceau et indexation immédiate
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

        // Validation stricte des champs obligatoires
        if (!nom_produit || !nom_producteur || !lot || !pays_origine) {
            return res.status(400).json({
                success: false,
                message: "Champs obligatoires manquants (nom_produit, nom_producteur, lot, pays_origine)."
            });
        }

        // Récupération des fichiers téléversés
        const files = req.files || {};
        const certificatFile = files['certificat_pdf'] ? files['certificat_pdf'][0] : null;
        const visuelFile = files['visuel'] ? files['visuel'][0] : null;

        // Association directe de l'URL/chemin du certificat vers le champ 'pdf_url'
        const pdf_url = certificatFile ? `/uploads/certificates/${certificatFile.filename}` : null;
        const visuel_url = visuelFile ? `/uploads/visuals/${visuelFile.filename}` : null;

        // Génération de l'identifiant unique ANOR
        const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
        const identifiant = `ANOR-${new Date().getFullYear()}-${randomHex}`;

        // Construction de la chaîne brute pour le calcul de l'empreinte géométrique SHA-256
        const rawString = `${identifiant}|${nom_produit}|${nom_producteur}|${lot}|${pays_origine}|${pdf_url || 'no_pdf'}|${Date.now()}`;
        const empreinte_geometrique = crypto.createHash('sha256').update(rawString).digest('hex');

        // Génération de la signature maître sécurisée
        const signature_maitre = crypto.createHmac('sha256', 'ANOR_MASTER_SECRET_KEY_V16')
            .update(empreinte_geometrique)
            .digest('hex');

        // Génération dynamique du Sceau SVG numérique officiel ANOR V16
        const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="100%" height="100%">
            <defs>
                <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#C5A059" />
                    <stop offset="100%" stop-color="#8C6D33" />
                </linearGradient>
            </defs>
            <circle cx="150" cy="150" r="140" fill="#0B2215" stroke="url(#goldGrad)" stroke-width="8"/>
            <circle cx="150" cy="150" r="125" fill="none" stroke="#C5A059" stroke-dasharray="4,4" stroke-width="2"/>
            <text x="150" y="55" fill="#C5A059" font-size="12" font-family="Arial, sans-serif" font-weight="bold" text-anchor="middle" letter-spacing="2">REPUBLIQUE DU CAMEROUN</text>
            <text x="150" y="75" fill="#FFFFFF" font-size="9" font-family="Arial, sans-serif" text-anchor="middle" letter-spacing="1">AGENCE NATIONALE DE NORMES ET DE QUALITÉ</text>
            <text x="150" y="140" fill="#FFFFFF" font-size="16" font-family="Arial, sans-serif" font-weight="bold" text-anchor="middle">${nom_produit.toUpperCase()}</text>
            <text x="150" y="165" fill="#C5A059" font-size="11" font-family="Arial, sans-serif" text-anchor="middle">LOT : ${lot}</text>
            <path id="curve" d="M 60,150 A 90,90 0 1,1 240,150" fill="transparent" />
            <text font-size="10" fill="#C5A059" font-family="Arial, sans-serif" letter-spacing="1">
                <textPath href="#curve" startOffset="50%" text-anchor="middle">CERTIFIÉ CONFORME • V16</textPath>
            </text>
            <rect x="50" y="195" width="200" height="45" rx="6" fill="#05120B" stroke="#C5A059" stroke-width="1.5"/>
            <text x="150" y="215" fill="#FFFFFF" font-size="9" font-family="monospace" text-anchor="middle">ID: ${identifiant}</text>
            <text x="150" y="230" fill="#C5A059" font-size="8" font-family="monospace" text-anchor="middle">SHA: ${empreinte_geometrique.substring(0, 16)}...</text>
        </svg>`;

        // Enregistrement structuré indexé
        const nouveauDossier = {
            identifiant,
            nom_produit,
            nom_producteur,
            composition: composition || "",
            lot,
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
            svg,           
            version: "ANOR-V16",
            created_at: new Date().toISOString()
        };

        db.insert(nouveauDossier);

        // Réponse JSON de succès transmise au frontend
        return res.status(200).json({
            success: true,
            message: "Sceau forgé et indexé en O(1) avec succès.",
            identifiant,
            empreinte_geometrique,
            signature_maitre,
            pdf_url,
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

// Endpoint pour débloquer et afficher le PNG HD / SVG du Sceau (Accès ultra-rapide)
app.get('/api/forge/png/:identifiant', (req, res) => {
    const { identifiant } = req.params;
    const record = db.findByIdentifiant(identifiant);

    if (!record || !record.svg) {
        return res.status(404).send("Sceau introuvable ou non généré.");
    }

    res.setHeader('Content-Type', 'image/svg+xml');
    return res.send(record.svg);
});

// Endpoint pour débloquer le Kit Complet (Recherche indexée instantanée)
app.get('/api/forge/kit/:identifiant', (req, res) => {
    const { identifiant } = req.params;
    const record = db.findByIdentifiant(identifiant);

    if (!record) {
        return res.status(404).json({
            success: false,
            message: "Kit introuvable pour cet identifiant."
        });
    }

    return res.status(200).json({
        success: true,
        message: "Kit complet de certification récupéré instantanément.",
        kit: {
            identifiant: record.identifiant,
            produit: record.nom_produit,
            producteur: record.nom_producteur,
            lot: record.lot,
            pays_origine: record.pays_origine,
            pdf_certificat: record.pdf_url ? `${req.protocol}://${req.get('host')}${record.pdf_url}` : null,
            visuel_produit: record.visuel_url ? `${req.protocol}://${req.get('host')}${record.visuel_url}` : null,
            empreinte_geometrique: record.empreinte_geometrique,
            signature_maitre: record.signature_maitre,
            date_generation: record.created_at
        }
    });
});

// Endpoint de lecture rapide / scan de vérification (Garantie de performance même à 10 millions d'entrées)
app.get('/api/registry/:identifiant', (req, res) => {
    const { identifiant } = req.params;
    
    // Accès direct par index de hachage Map : Temps d'exécution constant ~0 milliseconde
    const record = db.findByIdentifiant(identifiant);

    if (!record) {
        return res.status(404).json({
            success: false,
            message: "Aucun enregistrement trouvé pour cet identifiant ANOR."
        });
    }

    return res.status(200).json({
        success: true,
        data: record
    });
});

// Démarrage du serveur backend
app.listen(PORT, () => {
    console.log(`[ANOR-V16] Serveur backend opérationnel sur le port ${PORT} avec indexation haute performance en mémoire.`);
});