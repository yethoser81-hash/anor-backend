/**
 * ====================================================================
 * ANOR CHECK
 * SEAL RENDERER V33.0 - GEOMETRIE PRECISION IMPRESSION (ANTI-BAVURE)
 * ====================================================================
 */

const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const GlyphsLibrary = require('../library/glyphsLibrary');

const VISUAL_VERSION = 3;
const VISIBLE_GLYPH_COUNT = 28;
const CANONICAL_OUTER_RADIUS = 500;

const sealRenderer = {

    deriveVisualBits(seed) {
        const digest = crypto
            .createHash('sha256')
            .update(`ANOR_VISUAL_V${VISUAL_VERSION}:${String(seed)}`)
            .digest();

        let bits = '';
        for (const byte of digest) {
            bits += byte.toString(2).padStart(8, '0');
        }

        return bits.slice(0, VISIBLE_GLYPH_COUNT);
    },

    normalizeVisualBits(bits) {
        if (typeof bits === 'string' && new RegExp(`^[01]{${VISIBLE_GLYPH_COUNT}}$`).test(bits)) {
            return bits;
        }
        return null;
    },

    resolveProtocolGlyph(visibleIndex) {
        if (GlyphsLibrary && typeof GlyphsLibrary.resolveGlyph === 'function') {
            return GlyphsLibrary.resolveGlyph(visibleIndex);
        }
        return 'square';
    },

    getGeometry(width, height) {
        const outerRadius = Math.min(width, height) / 2 - 20;
        const centerX = width / 2;
        const centerY = height / 2;
        
        // Taille équilibrée du logo central pour ne jamais toucher le texte
        const logoSize = Math.round(width * 0.38); 
        const logoRadius = logoSize / 2;

        const outerRingRadius = outerRadius - 15;
        
        // Rayon positionnant le centre des glyphes étirés vers l'intérieur
        const singleRingRadius = outerRingRadius - 70; 

        return {
            centerX,
            centerY,
            outerRadius,
            logoSize,
            logoRadius,
            singleRingRadius,
            outerRingRadius
        };
    },

    getFinderAngles() {
        return [
            -Math.PI / 2, // Nord (0 rad)
            0,            // Est
            Math.PI / 2,  // Sud
            Math.PI       // Ouest
        ];
    },

    /**
     * Calcul des angles en évitant STRICTEMENT les zones des 4 mires
     */
    getVisiblePositions() {
        const positions = [];
        const count = VISIBLE_GLYPH_COUNT;
        const finderAngles = this.getFinderAngles();
        
        // Marge de protection autour de chaque mire (22 degrés)
        const safetyMargin = (22 * Math.PI) / 180; 

        let validAngles = [];
        let totalSteps = 120; // Discrétisation fine du cercle

        for (let i = 0; i < totalSteps; i++) {
            const angle = (i / totalSteps) * Math.PI * 2;
            let isNearFinder = false;

            for (const fAngle of finderAngles) {
                let diff = Math.abs(angle - fAngle);
                while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);
                if (diff < safetyMargin) {
                    isNearFinder = true;
                    break;
                }
            }

            if (!isNearFinder) {
                validAngles.push(angle);
            }
        }

        // Distribution uniforme des 28 glyphes dans les zones autorisées
        const step = validAngles.length / count;
        for (let i = 0; i < count; i++) {
            const index = Math.floor(i * step);
            positions.push({
                ring: 'single',
                angle: validAngles[index],
                index: i
            });
        }

        return positions;
    },

    async renderSealToBuffer(payload = {}, options = {}) {
        const width = Math.max(1080, Math.round(options.width || 1080));
        const height = Math.max(1080, Math.round(options.height || 1080));

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const GEOMETRY_COLOR = options.geometryColor || '#000000';
        const TEXT_PRIMARY_COLOR = options.textColor || '#000000';
        const TEXT_SECONDARY_COLOR = options.subTextColor || '#000000';
        const backgroundColor = options.backgroundColor || '#FFFFFF';

        const geometry = this.getGeometry(width, height);
        const {
            centerX,
            centerY,
            outerRadius,
            logoSize,
            logoRadius,
            singleRingRadius,
            outerRingRadius
        } = geometry;

        const scale = outerRadius / CANONICAL_OUTER_RADIUS;

        // Fond blanc propre
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, width, height);

        const rawBatchName =
            payload.lot ||
            payload.batchNumber ||
            payload.batchName ||
            payload.productName ||
            payload.name ||
            options.batchNumber ||
            options.lot ||
            'T57 421 0125';

        const normalizedBatchName = String(rawBatchName).trim().toUpperCase();
        const batchText = normalizedBatchName.replace(/^LOT\s*/i, '');

        const rawMasterLabel = options.masterSerialLabel || '000000';
        const cleanSerialNum = rawMasterLabel.split('/')[0].trim();

        const rawItemNumber =
            payload.itemNumber ??
            options.itemNumber ??
            payload.serialNumber ??
            options.serial;

        const itemText =
            rawItemNumber !== undefined && rawItemNumber !== null && !options.isMasterSeal && !payload.isMasterSeal
                ? String(rawItemNumber).split('/')[0].trim()
                : cleanSerialNum;

        const secureSignature = payload.secureSignature || payload.glyph_payload?.secureSignature || null;
        const suppliedVisualBits = payload.visualBits || payload.glyph_payload?.visualBits;

        const visualBits =
            this.normalizeVisualBits(suppliedVisualBits) ||
            this.deriveVisualBits(secureSignature || rawBatchName);

        // 1. Cercle Extérieur Noir Unique et Propre (Pas de double cercle parasite)
        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.lineWidth = Math.round(6 * scale);
        ctx.beginPath();
        ctx.arc(centerX, centerY, outerRingRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // 2. Logo Central Remonté pour dégager complètement le texte du lot
        const logoPath = options.logoPath || payload.logoPath || path.join(__dirname, '../assets/logo_anor_master.png');
        const logoCenterY = centerY - 95 * scale; // Remonté pour libérer l'espace bas

        if (fs.existsSync(logoPath)) {
            try {
                const img = await loadImage(logoPath);
                ctx.drawImage(
                    img,
                    centerX - logoRadius,
                    logoCenterY - logoRadius,
                    logoSize,
                    logoSize
                );
            } catch (error) {
                console.error('[sealRenderer] Erreur chargement logo :', error);
            }
        }

        // 3. Mires Cardinales Isoler et Parfaitement Dégagées
        const finderAngles = this.getFinderAngles();

        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.fillStyle = GEOMETRY_COLOR;

        for (let i = 0; i < finderAngles.length; i++) {
            const angle = finderAngles[i];
            const px = centerX + outerRingRadius * Math.cos(angle);
            const py = centerY + outerRingRadius * Math.sin(angle);

            ctx.save();
            ctx.translate(px, py);

            ctx.lineWidth = Math.round(5 * scale);
            // Mire carrée nette à cheval sur la ligne extérieure
            ctx.strokeRect(-18 * scale, -18 * scale, 36 * scale, 36 * scale);
            ctx.fillRect(-7 * scale, -7 * scale, 14 * scale, 14 * scale);

            ctx.restore();
        }
        ctx.restore();

        // 4. Glyphes Affinées, Espacées et Rallongées vers l'INTÉRIEUR
        const positions = this.getVisiblePositions();
        const glyphScale = 1.6 * scale; 
        const strokeWidth = Math.round(4.0 * scale); // Trait affiné pour éviter les pâtés d'impression

        ctx.save();

        for (let visibleIndex = 0; visibleIndex < positions.length; visibleIndex++) {
            const pos = positions[visibleIndex];
            const radius = singleRingRadius;
            const angle = pos.angle;

            const px = centerX + radius * Math.cos(angle);
            const py = centerY + radius * Math.sin(angle);

            const glyphType = this.resolveProtocolGlyph(visibleIndex);
            const glyphDef = GlyphsLibrary.getGlyphDefinition(glyphType);
            const isFilled = visualBits[visibleIndex] === '1';

            ctx.save();
            ctx.translate(px, py);
            // Orientation radiale dirigée vers le centre
            ctx.rotate(angle + Math.PI / 2);

            drawGlyphVectorInward(
                ctx,
                glyphType,
                glyphDef,
                isFilled,
                glyphScale,
                strokeWidth
            );

            ctx.restore();
        }
        ctx.restore();

        // 5. Textes Dégagés et Parfaitement Lisibles
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Positionnement bas aéré
        const textY = centerY + 185 * scale;

        // Numéro du Lot (Net, sans toucher le logo)
        ctx.font = `900 ${Math.round(46 * scale)}px sans-serif`;
        ctx.fillStyle = TEXT_PRIMARY_COLOR;
        ctx.fillText(`${batchText}`, centerX, textY - 10 * scale);

        // Numéro de Série (Taille équilibrée et lisible)
        ctx.font = `bold ${Math.round(36 * scale)}px sans-serif`;
        ctx.fillStyle = TEXT_SECONDARY_COLOR;
        ctx.fillText(`${itemText}`, centerX, textY + 38 * scale);

        ctx.restore();

        return canvas.toBuffer('image/png');
    }
};

/**
 * MOTEUR VECTORIEL : Rallonge la forme vers L'INTÉRIEUR et affine la largeur
 */
function drawGlyphVectorInward(ctx, type, def, isFilled, glyphScale = 1, strokeWidth = 3) {
    // Largeur affinée (w) pour garder l'espace anti-bavure, Hauteur (h) rallongée vers l'intérieur
    const w = (def.width || 16) * glyphScale * 0.85; 
    const h = (def.height || 16) * glyphScale * 1.50; // +50% d'allongement radial vers le centre

    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = '#000000';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'miter';

    switch (type) {
        case 'square':
        case 'bar':
        case 'rect':
            if (isFilled) ctx.fillRect(-w / 2, -h / 2, w, h);
            else ctx.strokeRect(-w / 2, -h / 2, w, h);
            break;

        case 'square_dot':
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            ctx.fillRect(-w / 5, -h / 5, (2 * w) / 5, (2 * h) / 5);
            break;

        case 'square_inner':
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            if (isFilled) ctx.fillRect(-w / 3, -h / 3, (2 * w) / 3, (2 * h) / 3);
            else ctx.strokeRect(-w / 4, -h / 4, w / 2, h / 2);
            break;

        case 'rect_half':
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            ctx.fillRect(-w / 2, -h / 2, w / 2, h);
            break;

        case 'circle':
            ctx.beginPath();
            ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
            if (isFilled) ctx.fill();
            else ctx.stroke();
            break;

        case 'circle_dot':
            ctx.beginPath();
            ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.ellipse(0, 0, w / 4, h / 4, 0, 0, Math.PI * 2);
            ctx.fill();
            break;

        case 'diamond':
            ctx.beginPath();
            ctx.moveTo(0, -h / 2);
            ctx.lineTo(w / 2, 0);
            ctx.lineTo(0, h / 2);
            ctx.lineTo(-w / 2, 0);
            ctx.closePath();
            if (isFilled) ctx.fill();
            else ctx.stroke();
            break;

        case 'diamond_inner':
            ctx.beginPath();
            ctx.moveTo(0, -h / 2);
            ctx.lineTo(w / 2, 0);
            ctx.lineTo(0, h / 2);
            ctx.lineTo(-w / 2, 0);
            ctx.closePath();
            ctx.stroke();
            ctx.fillRect(-w / 5, -h / 5, (2 * w) / 5, (2 * h) / 5);
            break;

        case 'plus':
            ctx.beginPath();
            ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0);
            ctx.moveTo(0, -h / 2); ctx.lineTo(0, h / 2);
            ctx.stroke();
            break;

        case 'triangle':
            ctx.beginPath();
            ctx.moveTo(0, -h / 2);
            ctx.lineTo(w / 2, h / 2);
            ctx.lineTo(-w / 2, h / 2);
            ctx.closePath();
            if (isFilled) ctx.fill();
            else ctx.stroke();
            break;

        case 'star':
            ctx.save();
            ctx.beginPath();
            for (let i = 0; i < 5; i++) {
                ctx.lineTo(Math.cos(((18 + i * 72) * Math.PI) / 180) * (w / 2), -Math.sin(((18 + i * 72) * Math.PI) / 180) * (h / 2));
                ctx.lineTo(Math.cos(((54 + i * 72) * Math.PI) / 180) * (w / 4), -Math.sin(((54 + i * 72) * Math.PI) / 180) * (h / 4));
            }
            ctx.closePath();
            if (isFilled) ctx.fill();
            else ctx.stroke();
            ctx.restore();
            break;

        default:
            if (isFilled) ctx.fillRect(-w / 2, -h / 2, w, h);
            else ctx.strokeRect(-w / 2, -h / 2, w, h);
    }
}

module.exports = sealRenderer;