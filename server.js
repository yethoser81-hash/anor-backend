/**
 * ==========================================================
 * server.js
 * ANOR V14
 * Point d'entrée principal du backend Node.js / Express
 * ==========================================================
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const VisionService = require('./services/visionService');
const KitGeneratorService = require('./services/kitGeneratorService');
const CacheSignature = require('./services/cacheSignature');

const app = express();
const port = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage() });

const cache = new CacheSignature(1000);

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir les fichiers statiques du dossier public (frontend, forge, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Route de test de santé du serveur
app.get('/api/health', (req, res) => {
    res.json({ status: 'online', version: '14.0.0', message: 'ANOR V14 Backend opérationnel' });
});

// Route de décodage des sceaux via vision par ordinateur
app.post('/api/decoder', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Aucune image transmise' });
        }

        const resultat = await VisionService.decoder(req.file.buffer);
        res.json(resultat);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Route de génération de kit d'impression et de sérialisation
app.post('/api/kit/generer', (req, res) => {
    try {
        const donneesLot = req.body;
        const kit = KitGeneratorService.genererKit(donneesLot);
        res.json({ success: true, kit });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Lancement du serveur
app.listen(port, () => {
    console.log(`Serveur ANOR V14 démarré sur le port ${port}`);
});