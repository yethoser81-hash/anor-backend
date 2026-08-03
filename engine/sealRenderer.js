/**
 * ====================================================================
 * ANOR CHECK
 * SEAL RENDERER V4.1 - Texte Géant et Lisible (Correction APK)
 * ====================================================================
 */

const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const GlyphsLibrary = require('../library/glyphsLibrary');
const AiBackendEngine = require('../engine/aiBackendEngine');

const sealRenderer = {
    renderSealToBuffer: async (payload = {}, options = {}) => {
        const width = options.width || 800;
        const height = options.height || 800;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        const centerX = width / 2;
        const centerY = height / 2;
        
        // Couleur de la structure géométrique
        const GEOMETRY_COLOR = options.geometryColor || '#4A90E2';

        // ==========================================
        // 1. EXTRACTION STRICTE DU NOM DE LOT / PRODUIT
        // ==========================================
        const rawBatchName = payload.lot || payload.batchNumber || payload.batchName || payload.productName || payload.name || options.batchNumber || options.lot;

        if (!rawBatchName) {
            throw new Error("[sealRenderer] ERREUR : Aucun nom de lot ou produit n'a été fourni dans le payload.");
        }

        const batchText = rawBatchName.toUpperCase().startsWith("LOT") ? rawBatchName : `LOT ${rawBatchName}`;

        const rawItemNumber = payload.itemNumber ?? options.itemNumber ?? payload.serialNumber ?? options.serial;
        
        let itemText = "";
        if (rawItemNumber !== undefined && rawItemNumber !== null && !options.isMasterSeal && !payload.isMasterSeal) {
            const hybridSerial = AiBackendEngine.toHybridSerial ? AiBackendEngine.toHybridSerial(rawItemNumber) : rawItemNumber;
            itemText = `N° ${hybridSerial}`;
        } else {
            itemText = "DM / 000 000";
        }

        // ==========================================
        // 2. GENERATION DE L'EMPREINTE UNIQUE (HASH SEED)
        // ==========================================
        const uniqueSeedSource = payload.productId || payload.id || payload.batchId || rawBatchName;
        const hashSeed = crypto.createHash('sha256').update(`ANOR_SEAL_${uniqueSeedSource}`).digest('hex');

        // Nettoyage du canvas (Fond blanc opaque pour un contraste maximal anti-flou)
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        // ==========================================
        // 3. CERCLE EXTÉRIEUR DE CLÔTURE
        // ==========================================
        const outerRadius = (Math.min(width, height) / 2) - 25; // 375px
        
        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.lineWidth = 5.0;
        ctx.beginPath();
        ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // ==========================================
        // 4. LOGO CENTRAL REDimensionné
        // ==========================================
        const logoSize = 220;
        const logoRadius = logoSize / 2;
        const logoPath = options.logoPath || payload.logoPath || path.join(__dirname, "../assets/logo_anor_master.png");

        if (fs.existsSync(logoPath)) {
            try {
                const img = await loadImage(logoPath);
                ctx.drawImage(
                    img,
                    centerX - logoRadius,
                    centerY - logoRadius - 40, // Remonté légèrement pour faire de la place aux textes
                    logoSize,
                    logoSize
                );
            } catch (error) {
                console.error("[ERREUR CHARGEMENT LOGO]", error);
            }
        }

        // ==========================================
        // 5. ANNEAUX CONCENTRIQUES & GLYPHES DYNAMIQUES
        // ==========================================
        const matrixData = payload.matrix || payload.glyph_payload?.matrix || [];

        const innerRingRadius = logoRadius + 50;                
        const outerRingRadius = outerRadius - 35;               
        const midRingRadius = (innerRingRadius + outerRingRadius) / 2; 

        const rings = [innerRingRadius, midRingRadius, outerRingRadius];
        const numPerRing = 20;

        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.fillStyle = GEOMETRY_COLOR;
        ctx.lineWidth = 3.5;

        rings.forEach((r, ringIdx) => {
            for (let i = 0; i < numPerRing; i++) {
                const globalIndex = (ringIdx * numPerRing) + i;
                const angle = (i / numPerRing) * Math.PI * 2;

                const hashByte = parseInt(hashSeed.substring((globalIndex * 2) % 60, ((globalIndex * 2) % 60) + 2), 16) || globalIndex;
                
                const item = matrixData[globalIndex] || {};
                const glyphType = item.glyph || GlyphsLibrary.resolveGlyph(hashByte);
                const glyphDef = GlyphsLibrary.getGlyphDefinition(glyphType);

                if (!glyphDef) {
                    throw new Error(`Glyphe inconnu : ${glyphType}`);
                }

                const isFilled = item.filled !== undefined
                    ? item.filled
                    : (hashByte % 2 === 0);

                const px = centerX + r * Math.cos(angle);
                const py = centerY + r * Math.sin(angle);

                ctx.save();
                ctx.translate(px, py);
                ctx.rotate(angle);

                drawGlyphFromDefinition(ctx, glyphType, glyphDef, isFilled);

                ctx.restore();
            }
        });

        ctx.restore();

        // ==========================================
        // 6. BLOC TEXTE GÉANT, HORIZONTAL ET HAUTE VISIBILITÉ (LOT & SÉRIE)
        // Placé au centre/bas du sceau pour lecture instantanée par l'APK
        // ==========================================
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Zone de fond blanc semi-opaque derrière les textes pour éliminer les interférences des glyphes
        const bannerY = centerY + 110;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fillRect(centerX - 240, bannerY - 45, 480, 95);

        // Bordure propre de la zone textuelle
        ctx.strokeStyle = '#111111';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(centerX - 240, bannerY - 45, 480, 95);

        // Ligne 1 : Numéro de Lot (Gros caractères bien lisibles)
        ctx.font = 'bold 26px sans-serif';
        ctx.fillStyle = '#000000';
        ctx.fillText(batchText.toUpperCase(), centerX, bannerY - 18);

        // Ligne 2 : Numéro de Série / Article (Gros caractères bien lisibles)
        ctx.font = 'bold 24px monospace';
        ctx.fillStyle = '#1A365D'; // Bleu foncé institutionnel fort
        ctx.fillText(itemText.toUpperCase(), centerX, bannerY + 22);

        ctx.restore();

        return canvas.toBuffer("image/png");
    }
};

function drawGlyphFromDefinition(ctx, type, def, isFilled) {
    ctx.beginPath();

    switch (type) {
        case 'square':
        case 'rect':
            if (isFilled) {
                ctx.fillRect(-def.width / 2, -def.height / 2, def.width, def.height);
            } else {
                ctx.strokeRect(-def.width / 2, -def.height / 2, def.width, def.height);
            }
            break;

        case 'circle':
            ctx.arc(0, 0, def.radius || (def.width / 2), 0, Math.PI * 2);
            if (isFilled) {
                ctx.fill();
            } else {
                ctx.stroke();
            }
            break;

        case 'diamond':
            ctx.rotate((def.rotation || 45) * Math.PI / 180);
            if (isFilled) {
                ctx.fillRect(-def.width / 2, -def.height / 2, def.width, def.height);
            } else {
                ctx.strokeRect(-def.width / 2, -def.height / 2, def.width, def.height);
            }
            break;

        case 'plus':
            {
                const hW = def.width / 2;
                const hH = def.height / 2;
                ctx.moveTo(-hW, 0); ctx.lineTo(hW, 0);
                ctx.moveTo(0, -hH); ctx.lineTo(0, hH);
                ctx.stroke();
            }
            break;

        default:
            if (isFilled) {
                ctx.fillRect(-def.width / 2, -def.height / 2, def.width, def.height);
            } else {
                ctx.strokeRect(-def.width / 2, -def.height / 2, def.width, def.height);
            }
            break;
    }
}

module.exports = sealRenderer;