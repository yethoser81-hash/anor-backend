/**
 * ====================================================================
 * ANOR CHECK
 * SEAL RENDERER V4.6 - Mires d'ancrage cardinales & Isolation optique CV
 * ====================================================================
 */

const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const GlyphsLibrary = require('../library/glyphsLibrary');

const sealRenderer = {
    renderSealToBuffer: async (payload = {}, options = {}) => {
        const width = options.width || 800;
        const height = options.height || 800;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        const centerX = width / 2;
        const centerY = height / 2;
        
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
            const hybridSerial = rawItemNumber;
            itemText = `N° ${hybridSerial}`;
        } else {
            itemText = "DM / 000 000";
        }

        // ==========================================
        // 2. GENERATION DE L'EMPREINTE UNIQUE (HASH SEED)
        // ==========================================
        const uniqueSeedSource = payload.productId || payload.id || payload.batchId || rawBatchName;
        const hashSeed = crypto.createHash('sha256').update(`ANOR_SEAL_${uniqueSeedSource}`).digest('hex');

        // Nettoyage du canvas : Fond TOTALEMENT TRANSPARENT
        ctx.clearRect(0, 0, width, height);

        // ==========================================
        // 3. CERCLE EXTÉRIEUR DE CLÔTURE
        // ==========================================
        const outerRadius = (Math.min(width, height) / 2) - 25; 
        
        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.lineWidth = 5.0;
        ctx.beginPath();
        ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // ==========================================
        // 4. LOGO CENTRAL
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
                    centerY - logoRadius - 35,
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

        const innerRingRadius = logoRadius + 45;               
        const outerRingRadius = outerRadius - 30;              
        const midRingRadius = (innerRingRadius + outerRingRadius) / 2; 

        // 4 Mires de positionnement fixes aux 4 points cardinaux exacts (0°, 90°, 180°, 270°)
        const finderCardinals = [
            0,             // 3 heures (Droite)
            Math.PI / 2,   // 6 heures (Bas)
            Math.PI,       // 9 heures (Gauche)
            (3 * Math.PI) / 2 // 12 heures (Haut)
        ];

        // Définition explicite de chaque anneau
        const ringConfigs = [
            { radius: innerRingRadius, count: 12, isInner: true },  // Anneau interne : ouvert en bas
            { radius: midRingRadius,   count: 24, isInner: false }, // Anneau médian : complet
            { radius: outerRingRadius, count: 32, isInner: false, hasFinders: true } // Anneau externe : avec mires cardinales
        ];

        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.fillStyle = GEOMETRY_COLOR;
        ctx.lineWidth = 3.5;

        let globalIndexOffset = 0;

        ringConfigs.forEach((ringConfig) => {
            const { radius: r, count: numPerRing, isInner, hasFinders } = ringConfig;

            for (let i = 0; i < numPerRing; i++) {
                const globalIndex = globalIndexOffset + i;
                const angle = (i / numPerRing) * Math.PI * 2;
                const angleDeg = (angle * 180) / Math.PI;

                // SEUL l'anneau interne est filtré en bas pour ne garder que l'arc supérieur
                if (isInner) {
                    if (angleDeg >= 20 && angleDeg <= 160) {
                        continue; 
                    }
                }

                // Si c'est l'anneau externe, on évite de dessiner un glyphe si on est proche d'une mire cardinale
                if (hasFinders) {
                    let collidesWithFinder = false;
                    for (const targetAngle of finderCardinals) {
                        let diff = Math.abs(angle - targetAngle);
                        if (diff > Math.PI) diff = (Math.PI * 2) - diff;
                        // Tolérance d'environ 12° (~0.21 rad) pour laisser une "quiet zone" propre autour de la mire
                        if (diff < 0.22) {
                            collidesWithFinder = true;
                            break;
                        }
                    }
                    if (collidesWithFinder) {
                        continue; 
                    }
                }

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

            globalIndexOffset += numPerRing;
        });

        // ==========================================
        // 5.2. DESSIN DES 4 MIRES CARDINALES DE CALIBRATION
        // ==========================================
        finderCardinals.forEach((targetAngle) => {
            const px = centerX + outerRingRadius * Math.cos(targetAngle);
            const py = centerY + outerRingRadius * Math.sin(targetAngle);

            ctx.save();
            ctx.translate(px, py);
            // Pas de rotation de la mire elle-même pour qu'elle reste parfaitement alignée sur les axes X/Y de la caméra
            
            ctx.lineWidth = 3.0;
            ctx.strokeStyle = GEOMETRY_COLOR;
            ctx.fillStyle = GEOMETRY_COLOR;

            // Dessin d'une mire de type "Cible Carrée Concentrique" (très robuste pour la détection OpenCV)
            ctx.strokeRect(-10, -10, 20, 20);
            ctx.fillRect(-4, -4, 8, 8);

            ctx.restore();
        });

        ctx.restore();

        // ==========================================
        // 6. BLOC TEXTE HORIZONTAL ET SANS FOND OPAQUE
        // ==========================================
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const textY = centerY + 115;

        const drawOutlinedText = (txt, x, y, fontStyle, textColor = '#FFFFFF') => {
            ctx.font = fontStyle;
            
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 5.5;
            ctx.lineJoin = 'round';
            ctx.strokeText(txt, x, y);

            ctx.fillStyle = textColor;
            ctx.fillText(txt, x, y);
        };

        // Ligne 1 : Numéro de Lot
        drawOutlinedText(batchText.toUpperCase(), centerX, textY - 18, 'bold 28px sans-serif', '#FFFFFF');

        // Ligne 2 : Numéro de Série
        drawOutlinedText(itemText.toUpperCase(), centerX, textY + 22, 'bold 26px monospace', '#E2E8F0');

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