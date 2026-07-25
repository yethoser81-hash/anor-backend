const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const GlyphsLibrary = require('../library/glyphsLibrary');
const AiBackendEngine = require('../engine/aiBackendEngine');

/**
 * Moteur de rendu du Sceau ANOR
 */
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

        // Formatage du texte du lot (ex: "LOT 89P-206" ou nom du produit)
        const batchText = rawBatchName.toUpperCase().startsWith("LOT") ? rawBatchName : `LOT ${rawBatchName}`;

        const rawItemNumber = payload.itemNumber ?? options.itemNumber ?? payload.serialNumber ?? options.serial;
        
        let itemText = "";
        if (rawItemNumber !== undefined && rawItemNumber !== null && !options.isMasterSeal && !payload.isMasterSeal) {
            const hybridSerial = AiBackendEngine.toHybridSerial ? AiBackendEngine.toHybridSerial(rawItemNumber) : rawItemNumber;
            itemText = `N° ${hybridSerial}`;
        } else {
            // Sceau Maître : affichage visuel 000 000
            itemText = "SÉRIE : DM / 000 000";
        }

        // ==========================================
        // 2. GENERATION DE L'EMPREINTE UNIQUE (HASH SEED)
        // Calculée directement depuis le lot / produit réel transmis
        // ==========================================
        const uniqueSeedSource = payload.productId || payload.id || payload.batchId || rawBatchName;
        const hashSeed = crypto.createHash('sha256').update(`ANOR_SEAL_${uniqueSeedSource}`).digest('hex');

        // Nettoyage du canvas
        ctx.clearRect(0, 0, width, height);

        // ==========================================
        // 3. CERCLE EXTÉRIEUR DE CLÔTURE
        // ==========================================
        const outerRadius = (Math.min(width, height) / 2) - 25; // 375px
        
        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.lineWidth = 4.0;
        ctx.beginPath();
        ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // ==========================================
        // 4. LOGO CENTRAL
        // ==========================================
        const logoSize = 270;
        const logoRadius = logoSize / 2;
        const logoPath = options.logoPath || payload.logoPath || path.resolve(process.cwd(), 'assets/logo_anor_master.png');

        if (fs.existsSync(logoPath)) {
            try {
                const img = await loadImage(logoPath);
                ctx.drawImage(
                    img,
                    centerX - logoRadius,
                    centerY - logoRadius,
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

        const innerRingRadius = logoRadius + 40;                // 175px
        const outerRingRadius = outerRadius - 35;               // 340px
        const midRingRadius = (innerRingRadius + outerRingRadius) / 2; // 257.5px

        const rings = [innerRingRadius, midRingRadius, outerRingRadius];
        const numPerRing = 20;

        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.fillStyle = GEOMETRY_COLOR;
        ctx.lineWidth = 3.0;

        rings.forEach((r, ringIdx) => {
            const isInnerRing = (ringIdx === 0);

            for (let i = 0; i < numPerRing; i++) {
                const globalIndex = (ringIdx * numPerRing) + i;
                const angle = (i / numPerRing) * Math.PI * 2;

                // Zone d'exclusion bas pour le texte curviligne
                if (isInnerRing) {
                    const normalizedAngle = (angle + Math.PI * 2) % (Math.PI * 2);
                    if (normalizedAngle > 0.75 && normalizedAngle < 2.39) {
                        continue;
                    }
                }

                // Hachage propre pour chaque forme basé sur l'identifiant unique réel
                const hashByte = parseInt(hashSeed.substring((globalIndex * 2) % 60, ((globalIndex * 2) % 60) + 2), 16) || globalIndex;
                
                const item = matrixData[globalIndex] || {};
                const glyphTypeIndex = item.type !== undefined ? item.type : hashByte;
                const glyphType = GlyphsLibrary.resolveGlyph(glyphTypeIndex);
                const glyphDef = GlyphsLibrary.getGlyphDefinition(glyphType);

                const isFilled = item.isFilled !== undefined ? item.isFilled : (hashByte % 2 === 0);

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
        // 6. TEXTE SÉRIALISÉ (Contours Noirs + Remplissage Blanc)
        // ==========================================
        ctx.save();
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Ligne 1 : Nom exact du Lot / Produit
        drawArcTextBottomHighContrast(ctx, batchText.toUpperCase(), centerX, centerY, innerRingRadius - 8, Math.PI / 2);

        // Ligne 2 : Série / Numéro Sceau
        drawArcTextBottomHighContrast(ctx, itemText.toUpperCase(), centerX, centerY, innerRingRadius + 14, Math.PI / 2);
        
        ctx.restore();

        return canvas.toBuffer("image/png");
    }
};

function drawGlyphFromDefinition(ctx, type, def, isFilled) {
    ctx.beginPath();

    switch (type) {
        case 'square':
            if (isFilled) {
                ctx.fillRect(-def.width / 2, -def.height / 2, def.width, def.height);
            } else {
                ctx.strokeRect(-def.width / 2, -def.height / 2, def.width, def.height);
            }
            break;

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
                ctx.beginPath();
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

function drawArcTextBottomHighContrast(ctx, text, cx, cy, radius, centerAngle) {
    const anglePerChar = 0.072;
    const startAngle = centerAngle + ((text.length - 1) * anglePerChar) / 2;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const angle = startAngle - i * anglePerChar;

        ctx.save();
        ctx.translate(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
        ctx.rotate(angle - Math.PI / 2);

        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 4.5;
        ctx.lineJoin = 'round';
        ctx.strokeText(char, 0, 0);

        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(char, 0, 0);

        ctx.restore();
    }
}

module.exports = sealRenderer;