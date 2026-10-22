/**
 * ====================================================================
 * ANOR CHECK
 * SEAL RENDERER V36.0 - GEOMETRIE NETTE ET SANS CHEVAUCHEMENT
 * ====================================================================
 */

const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const GlyphsLibrary = require('../library/glyphsLibrary');

const VISUAL_VERSION = 4;
const VISIBLE_GLYPH_COUNT = 28;
const CANONICAL_OUTER_RADIUS = 500;

const sealRenderer = {

    deriveVisualBits(seed) {
        let bits = '';
        const cleanSeed = String(seed).trim().toUpperCase();

        for (let i = 0; i < VISIBLE_GLYPH_COUNT; i++) {
            const hmac = crypto
                .createHmac('sha256', `ANOR_SALT_V${VISUAL_VERSION}_GLYPH_${i}`)
                .update(cleanSeed)
                .digest();
            bits += (hmac[0] % 2 === 0) ? '1' : '0';
        }

        return bits;
    },

    normalizeVisualBits(bits) {
        if (typeof bits === 'string' && new RegExp(`^[01]{${VISIBLE_GLYPH_COUNT}}$`).test(bits)) {
            return bits;
        }
        return null;
    },

    resolveProtocolGlyph(visibleIndex, seed = '') {
        if (GlyphsLibrary && typeof GlyphsLibrary.resolveGlyph === 'function') {
            const hash = crypto.createHash('md5').update(`${seed}_POS_${visibleIndex}`).digest();
            const glyphIndex = hash[0] % GlyphsLibrary.types.length;
            return GlyphsLibrary.types[glyphIndex];
        }
        return 'square';
    },

    getGeometry(width, height) {
        const outerRadius = Math.min(width, height) / 2 - 25;
        const centerX = width / 2;
        const centerY = height / 2;
        
        // Taille réduite du logo central pour éviter tout chevauchement avec le texte
        const logoSize = Math.round(width * 0.32); 
        const logoRadius = logoSize / 2;

        const outerRingRadius = outerRadius - 10;
        // Point d'ancrage sous le cercle extérieur pour étirement vers l'intérieur
        const singleRingRadius = outerRingRadius - 35; 

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
            -Math.PI / 2, // Nord
            0,            // Est
            Math.PI / 2,  // Sud
            Math.PI       // Ouest
        ];
    },

    getVisiblePositions() {
        const positions = [];
        const count = VISIBLE_GLYPH_COUNT;
        const finderAngles = this.getFinderAngles();
        
        // Safety margin de 20 degrés autour de chaque mire
        const safetyMargin = (20 * Math.PI) / 180; 

        let validAngles = [];
        const totalSteps = 360; 

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

        const step = validAngles.length / count;
        for (let i = 0; i < count; i++) {
            const index = Math.min(Math.floor(i * step), validAngles.length - 1);
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

        // Fond blanc pur
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
            'J854 1254';

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

        // 1. CERCLE UNIQUE EXTERIEUR (SANS CERCLE SECONDAIRE PARASITE)
        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.lineWidth = Math.round(5 * scale);
        ctx.beginPath();
        ctx.arc(centerX, centerY, outerRingRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // 2. LOGO CENTRAL REMONTÉ (AUCUN CHEVAUCHEMENT AVEC LE LOT)
        const logoPath = options.logoPath || payload.logoPath || path.join(__dirname, '../assets/logo_anor_master.png');
        const logoCenterY = centerY - 100 * scale; 

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

        // 3. MIRES CARDINALES DÉGAGÉES AUX 4 POINTS CARDINAUX
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

            ctx.lineWidth = Math.round(4 * scale);
            ctx.strokeRect(-15 * scale, -15 * scale, 30 * scale, 30 * scale);
            ctx.fillRect(-5 * scale, -5 * scale, 10 * scale, 10 * scale);

            ctx.restore();
        }
        ctx.restore();

        // 4. GLYPHES AFFINÉES, ALLONGÉES VERS LE CENTRE ET ESPACÉES
        const positions = this.getVisiblePositions();
        const glyphScale = 1.1 * scale; 
        const strokeWidth = Math.round(3.5 * scale);

        ctx.save();

        for (let visibleIndex = 0; visibleIndex < positions.length; visibleIndex++) {
            const pos = positions[visibleIndex];
            const radius = singleRingRadius;
            const angle = pos.angle;

            const px = centerX + radius * Math.cos(angle);
            const py = centerY + radius * Math.sin(angle);

            const glyphType = this.resolveProtocolGlyph(visibleIndex, rawBatchName);
            const glyphDef = GlyphsLibrary.getGlyphDefinition(glyphType);
            const isFilled = visualBits[visibleIndex] === '1';

            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(angle + Math.PI / 2);

            drawGlyphInwardThin(
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

        // 5. TEXTES DU LOT ET DE SÉRIE PARFAITEMENT DÉGAGÉS
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const textY = centerY + 180 * scale;

        // Numéro du lot
        ctx.font = `900 ${Math.round(44 * scale)}px sans-serif`;
        ctx.fillStyle = TEXT_PRIMARY_COLOR;
        ctx.fillText(`${batchText}`, centerX, textY - 10 * scale);

        // Numéro de série
        ctx.font = `bold ${Math.round(34 * scale)}px sans-serif`;
        ctx.fillStyle = TEXT_SECONDARY_COLOR;
        ctx.fillText(`${itemText}`, centerX, textY + 35 * scale);

        ctx.restore();

        return canvas.toBuffer('image/png');
    }
};

/**
 * Moteur de rendu vectoriel : Formes affinées et allongées vers le centre
 */
function drawGlyphInwardThin(ctx, type, def, isFilled, glyphScale = 1, strokeWidth = 3) {
    const w = (def.width || 14) * glyphScale * 0.70; // Trait plus fin pour laisser des espaces nets
    const h = (def.height || 14) * glyphScale * 1.60; // Allongement radial net vers le centre

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

        case 'rect_double':
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            ctx.strokeRect(-w / 4, -h / 4, w / 2, h / 2);
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

        default:
            if (isFilled) ctx.fillRect(-w / 2, -h / 2, w, h);
            else ctx.strokeRect(-w / 2, -h / 2, w, h);
    }
}

module.exports = sealRenderer;