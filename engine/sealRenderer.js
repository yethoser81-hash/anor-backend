javascript
/**
 * ====================================================================
 * ANOR CHECK
 * SEAL RENDERER V5.0 - SQUARE SCAN OPTIMIZED
 * ====================================================================
 *
 * Objectif :
 * - Sceau carré facilement détectable par caméra
 * - 4 repères de position dans les coins
 * - 3 couches de glyphes
 * - Logo central
 * - Zone LOT dédiée à l'OCR
 * - Géométrie stable pour correction de perspective
 *
 * Architecture visuelle :
 *
 *   ┌───────────────────────────────────────┐
 *   │  ┌───┐                         ┌───┐  │
 *   │  │ ■ │  GLYPHES - COUCHE 3     │ ■ │  │
 *   │  └───┘                         └───┘  │
 *   │                                       │
 *   │       GLYPHES - COUCHE 2              │
 *   │                                       │
 *   │          ┌─────────────┐              │
 *   │          │    LOGO     │              │
 *   │          └─────────────┘              │
 *   │                                       │
 *   │          ┌─────────────┐              │
 *   │          │ LOT 45P-2026│ ← OCR        │
 *   │          └─────────────┘              │
 *   │                                       │
 *   │  ┌───┐                         ┌───┐  │
 *   │  │ ■ │  GLYPHES - COUCHE 1     │ ■ │  │
 *   │  └───┘                         └───┘  │
 *   └───────────────────────────────────────┘
 */

const { createCanvas, loadImage } = require("canvas");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const GlyphsLibrary = require("../library/glyphsLibrary");

const sealRenderer = {

    renderSealToBuffer: async (payload = {}, options = {}) => {

        // ============================================================
        // 1. DIMENSIONS
        // ============================================================

        const width = options.width || 800;
        const height = options.height || 800;

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext("2d");

        const centerX = width / 2;
        const centerY = height / 2;

        /*
         * Noir par défaut.
         *
         * Pour un sceau imprimé, le contraste noir/blanc est
         * beaucoup plus favorable à la caméra qu'un bleu clair.
         */
        const GEOMETRY_COLOR = options.geometryColor || "#111111";

        // ============================================================
        // 2. EXTRACTION DU LOT
        // ============================================================

        const rawBatchName =
            payload.lot ||
            payload.batchNumber ||
            payload.batchName ||
            payload.productName ||
            payload.name ||
            options.batchNumber ||
            options.lot;

        if (!rawBatchName) {
            throw new Error(
                "[sealRenderer] ERREUR : Aucun numéro de lot fourni."
            );
        }

        const normalizedLot = String(rawBatchName)
            .trim()
            .toUpperCase()
            .replace(/^LOT[\s:_-]*/i, "");

        const batchText = `LOT ${normalizedLot}`;

        // ============================================================
        // 3. NUMERO DE SERIE
        // ============================================================

        const rawItemNumber =
            payload.itemNumber ??
            options.itemNumber ??
            payload.serialNumber ??
            options.serial;

        let itemText = "";

        if (
            rawItemNumber !== undefined &&
            rawItemNumber !== null &&
            !options.isMasterSeal &&
            !payload.isMasterSeal
        ) {
            itemText = `N° ${rawItemNumber}`;
        } else {
            itemText = "DM / 000 000";
        }

        // ============================================================
        // 4. EMPREINTE CRYPTOGRAPHIQUE
        // ============================================================

        const uniqueSeedSource =
            payload.productId ||
            payload.id ||
            payload.batchId ||
            normalizedLot;

        const hashSeed = crypto
            .createHash("sha256")
            .update(`ANOR_SQUARE_SEAL_${uniqueSeedSource}`)
            .digest("hex");

        const matrixData =
            payload.matrix ||
            payload.glyph_payload?.matrix ||
            [];

        // ============================================================
        // 5. CANVAS TRANSPARENT
        // ============================================================

        ctx.clearRect(0, 0, width, height);

        // ============================================================
        // 6. GEOMETRIE PRINCIPALE
        // ============================================================

        /*
         * Marge extérieure.
         *
         * Le carré doit rester largement séparé du bord de l'image
         * afin que la caméra puisse distinguer les quatre coins.
         */
        const margin = options.margin || 28;

        const sealLeft = margin;
        const sealTop = margin;
        const sealRight = width - margin;
        const sealBottom = height - margin;

        const sealWidth = sealRight - sealLeft;
        const sealHeight = sealBottom - sealTop;

        // ============================================================
        // 7. CADRE EXTERIEUR
        // ============================================================

        ctx.save();

        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.lineWidth = 7;
        ctx.lineJoin = "round";

        ctx.strokeRect(
            sealLeft,
            sealTop,
            sealWidth,
            sealHeight
        );

        // Deuxième cadre intérieur.
        ctx.lineWidth = 2.5;

        const innerFrameInset = 16;

        ctx.strokeRect(
            sealLeft + innerFrameInset,
            sealTop + innerFrameInset,
            sealWidth - innerFrameInset * 2,
            sealHeight - innerFrameInset * 2
        );

        ctx.restore();

        // ============================================================
        // 8. REPÈRES DES 4 COINS
        // ============================================================
        //
        // Ces repères sont volontairement inspirés des marqueurs
        // de position des QR codes.
        //
        // Leur fonction n'est PAS décorative.
        //
        // camera_ia.js pourra ultérieurement chercher :
        //
        //     ● coin haut gauche
        //     ● coin haut droit
        //     ● coin bas gauche
        //     ● coin bas droit
        //
        // puis calculer la perspective.
        // ============================================================

        const markerSize = options.markerSize || 72;

        const markerOffset = options.markerOffset || 42;

        drawFinderMarker(
            ctx,
            sealLeft + markerOffset,
            sealTop + markerOffset,
            markerSize,
            GEOMETRY_COLOR
        );

        drawFinderMarker(
            ctx,
            sealRight - markerOffset,
            sealTop + markerOffset,
            markerSize,
            GEOMETRY_COLOR
        );

        drawFinderMarker(
            ctx,
            sealLeft + markerOffset,
            sealBottom - markerOffset,
            markerSize,
            GEOMETRY_COLOR
        );

        drawFinderMarker(
            ctx,
            sealRight - markerOffset,
            sealBottom - markerOffset,
            markerSize,
            GEOMETRY_COLOR
        );

        // ============================================================
        // 9. GLYPHES - TROIS COUCHES
        // ============================================================

        /*
         * On abandonne les anneaux circulaires comme structure
         * principale.
         *
         * Les glyphes suivent maintenant des contours carrés.
         *
         * Cela renforce la signature géométrique du sceau et permet
         * à la caméra de comprendre immédiatement son orientation.
         */

        const outerInset = 115;
        const middleInset = 165;
        const innerInset = 215;

        const ringConfigs = [
            {
                inset: outerInset,
                count: 40,
                lineWidth: 3.2,
                size: 18
            },
            {
                inset: middleInset,
                count: 32,
                lineWidth: 3.0,
                size: 16
            },
            {
                inset: innerInset,
                count: 24,
                lineWidth: 2.8,
                size: 15
            }
        ];

        let globalIndexOffset = 0;

        ringConfigs.forEach((ringConfig) => {

            const {
                inset,
                count,
                lineWidth,
                size
            } = ringConfig;

            ctx.save();

            ctx.strokeStyle = GEOMETRY_COLOR;
            ctx.fillStyle = GEOMETRY_COLOR;
            ctx.lineWidth = lineWidth;

            for (let i = 0; i < count; i++) {

                const t = i / count;

                const position = pointOnSquarePerimeter(
                    sealLeft + inset,
                    sealTop + inset,
                    sealRight - inset,
                    sealBottom - inset,
                    t
                );

                const globalIndex =
                    globalIndexOffset + i;

                /*
                 * Utilisation du hash pour déterminer le glyphe.
                 */
                const hashPosition =
                    (globalIndex * 2) % (hashSeed.length - 2);

                const hashByte =
                    parseInt(
                        hashSeed.substring(
                            hashPosition,
                            hashPosition + 2
                        ),
                        16
                    ) || globalIndex;

                const item =
                    matrixData[globalIndex] || {};

                const glyphType =
                    item.glyph ||
                    GlyphsLibrary.resolveGlyph(hashByte);

                const glyphDef =
                    GlyphsLibrary.getGlyphDefinition(glyphType);

                if (!glyphDef) {
                    throw new Error(
                        `Glyphe inconnu : ${glyphType}`
                    );
                }

                const isFilled =
                    item.filled !== undefined
                        ? item.filled
                        : hashByte % 2 === 0;

                ctx.save();

                ctx.translate(
                    position.x,
                    position.y
                );

                ctx.rotate(position.rotation);

                /*
                 * Normalisation de la taille.
                 *
                 * On empêche un glyphe de devenir trop gros et de
                 * toucher les repères ou les zones OCR.
                 */
                drawGlyphScaled(
                    ctx,
                    glyphType,
                    glyphDef,
                    isFilled,
                    size
                );

                ctx.restore();
            }

            ctx.restore();

            globalIndexOffset += count;
        });

        // ============================================================
        // 10. LOGO CENTRAL
        // ============================================================

        const logoSize = options.logoSize || 190;

        const logoPath =
            options.logoPath ||
            payload.logoPath ||
            path.join(
                __dirname,
                "../assets/logo_anor_master.png"
            );

        if (fs.existsSync(logoPath)) {

            try {

                const img = await loadImage(logoPath);

                /*
                 * Zone blanche/opaque derrière le logo.
                 *
                 * Cela évite que les glyphes traversent visuellement
                 * le logo et simplifie sa détection.
                 */
                ctx.save();

                ctx.fillStyle = "#FFFFFF";

                ctx.beginPath();
                ctx.arc(
                    centerX,
                    centerY - 55,
                    logoSize / 2 + 18,
                    0,
                    Math.PI * 2
                );
                ctx.fill();

                ctx.restore();

                ctx.drawImage(
                    img,
                    centerX - logoSize / 2,
                    centerY - logoSize / 2 - 55,
                    logoSize,
                    logoSize
                );

            } catch (error) {

                console.error(
                    "[ERREUR CHARGEMENT LOGO]",
                    error
                );
            }
        }

        // ============================================================
        // 11. ZONE OCR DU LOT
        // ============================================================
        //
        // C'est une modification très importante.
        //
        // Le lot est toujours dessiné dans une zone rectangulaire
        // connue.
        //
        // camera_ia.js pourra donc :
        //
        // 1. détecter les 4 coins
        // 2. redresser le carré
        // 3. prendre uniquement cette zone
        // 4. envoyer cette zone à Tesseract
        //
        // Au lieu de faire OCR sur tout le sceau.
        // ============================================================

        const lotBoxWidth = Math.min(
            390,
            sealWidth - 260
        );

        const lotBoxHeight = 72;

        const lotBoxX =
            centerX - lotBoxWidth / 2;

        const lotBoxY =
            centerY + 115;

        // Fond blanc OCR
        ctx.save();

        ctx.fillStyle = "#FFFFFF";

        ctx.fillRect(
            lotBoxX,
            lotBoxY,
            lotBoxWidth,
            lotBoxHeight
        );

        // Cadre noir épais
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.lineWidth = 4;

        ctx.strokeRect(
            lotBoxX,
            lotBoxY,
            lotBoxWidth,
            lotBoxHeight
        );

        ctx.restore();

        // ============================================================
        // 12. TEXTE DU LOT
        // ============================================================

        ctx.save();

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        /*
         * "LOT" petit.
         */
        ctx.fillStyle = GEOMETRY_COLOR;
        ctx.font = "bold 18px sans-serif";

        ctx.fillText(
            "LOT",
            centerX,
            lotBoxY + 18
        );

        /*
         * Numéro de lot très lisible.
         *
         * Police monospace pour avoir une largeur régulière.
         */
        ctx.font = "bold 29px monospace";

        ctx.fillText(
            normalizedLot,
            centerX,
            lotBoxY + 48
        );

        ctx.restore();

        // ============================================================
        // 13. NUMERO DE SERIE
        // ============================================================

        ctx.save();

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.fillStyle = GEOMETRY_COLOR;
        ctx.font = "bold 18px monospace";

        ctx.fillText(
            itemText.toUpperCase(),
            centerX,
            lotBoxY + lotBoxHeight + 28
        );

        ctx.restore();

        // ============================================================
        // 14. IDENTIFICATION DU SYSTEME
        // ============================================================

        ctx.save();

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.fillStyle = GEOMETRY_COLOR;

        ctx.font = "bold 14px sans-serif";

        ctx.fillText(
            "AUTHENTICITE GARANTIE",
            centerX,
            sealBottom - 52
        );

        ctx.font = "11px sans-serif";

        ctx.fillText(
            "ANOR • SCEAU DE CERTIFICATION",
            centerX,
            sealBottom - 32
        );

        ctx.restore();

        // ============================================================
        // 15. PETITS REPÈRES DE CALAGE
        // ============================================================

        /*
         * Ces petits traits supplémentaires permettent de renforcer
         * les lignes horizontales et verticales du sceau.
         */

        drawCalibrationTicks(
            ctx,
            sealLeft,
            sealTop,
            sealRight,
            sealBottom,
            GEOMETRY_COLOR
        );

        // ============================================================
        // 16. EXPORT PNG
        // ============================================================

        return canvas.toBuffer("image/png");
    }
};


// ====================================================================
// FINDER MARKER
// ====================================================================
//
// Structure :
//
// ┌─────────────┐
// │ ███████████ │
// │ █         █ │
// │ █   ███   █ │
// │ █   ███   █ │
// │ █         █ │
// │ ███████████ │
// └─────────────┘
//
// C'est volontairement très proche d'un marqueur QR.
// ====================================================================

function drawFinderMarker(
    ctx,
    centerX,
    centerY,
    size,
    color
) {

    const outer = size;
    const middle = size * 0.62;
    const inner = size * 0.28;

    ctx.save();

    ctx.fillStyle = color;

    // Carré extérieur noir
    ctx.fillRect(
        centerX - outer / 2,
        centerY - outer / 2,
        outer,
        outer
    );

    // Carré intérieur blanc
    ctx.fillStyle = "#FFFFFF";

    ctx.fillRect(
        centerX - middle / 2,
        centerY - middle / 2,
        middle,
        middle
    );

    // Carré central noir
    ctx.fillStyle = color;

    ctx.fillRect(
        centerX - inner / 2,
        centerY - inner / 2,
        inner,
        inner
    );

    ctx.restore();
}


// ====================================================================
// POINT SUR LE PERIMETRE CARRE
// ====================================================================
//
// t = 0.00 → haut gauche
// t = 0.25 → haut droit
// t = 0.50 → bas droit
// t = 0.75 → bas gauche
// t = 1.00 → haut gauche
//
// Retourne également la rotation du glyphe.
// ====================================================================

function pointOnSquarePerimeter(
    left,
    top,
    right,
    bottom,
    t
) {

    const perimeter =
        2 * ((right - left) + (bottom - top));

    let distance =
        (t % 1) * perimeter;

    const topLength =
        right - left;

    const rightLength =
        bottom - top;

    const bottomLength =
        right - left;

    // ------------------------------------------------------------
    // COTE HAUT
    // ------------------------------------------------------------

    if (distance <= topLength) {

        return {
            x: left + distance,
            y: top,
            rotation: 0
        };
    }

    distance -= topLength;

    // ------------------------------------------------------------
    // COTE DROIT
    // ------------------------------------------------------------

    if (distance <= rightLength) {

        return {
            x: right,
            y: top + distance,
            rotation: Math.PI / 2
        };
    }

    distance -= rightLength;

    // ------------------------------------------------------------
    // COTE BAS
    // ------------------------------------------------------------

    if (distance <= bottomLength) {

        return {
            x: right - distance,
            y: bottom,
            rotation: Math.PI
        };
    }

    distance -= bottomLength;

    // ------------------------------------------------------------
    // COTE GAUCHE
    // ------------------------------------------------------------

    return {
        x: left,
        y: bottom - distance,
        rotation: -Math.PI / 2
    };
}


// ====================================================================
// GLYPHE NORMALISE
// ====================================================================

function drawGlyphScaled(
    ctx,
    type,
    def,
    isFilled,
    targetSize
) {

    const baseWidth =
        def.width ||
        def.radius * 2 ||
        20;

    const scale =
        targetSize / baseWidth;

    ctx.save();

    ctx.scale(
        scale,
        scale
    );

    drawGlyphFromDefinition(
        ctx,
        type,
        def,
        isFilled
    );

    ctx.restore();
}


// ====================================================================
// DESSIN DES GLYPHES
// ====================================================================

function drawGlyphFromDefinition(
    ctx,
    type,
    def,
    isFilled
) {

    ctx.beginPath();

    switch (type) {

        case "square":
        case "rect":

            if (isFilled) {

                ctx.fillRect(
                    -def.width / 2,
                    -def.height / 2,
                    def.width,
                    def.height
                );

            } else {

                ctx.strokeRect(
                    -def.width / 2,
                    -def.height / 2,
                    def.width,
                    def.height
                );
            }

            break;


        case "circle":

            ctx.arc(
                0,
                0,
                def.radius ||
                def.width / 2,
                0,
                Math.PI * 2
            );

            if (isFilled) {
                ctx.fill();
            } else {
                ctx.stroke();
            }

            break;


        case "diamond":

            ctx.rotate(
                (def.rotation || 45) *
                Math.PI /
                180
            );

            if (isFilled) {

                ctx.fillRect(
                    -def.width / 2,
                    -def.height / 2,
                    def.width,
                    def.height
                );

            } else {

                ctx.strokeRect(
                    -def.width / 2,
                    -def.height / 2,
                    def.width,
                    def.height
                );
            }

            break;


        case "plus": {

            const hW =
                def.width / 2;

            const hH =
                def.height / 2;

            ctx.moveTo(
                -hW,
                0
            );

            ctx.lineTo(
                hW,
                0
            );

            ctx.moveTo(
                0,
                -hH
            );

            ctx.lineTo(
                0,
                hH
            );

            ctx.stroke();

            break;
        }


        default:

            if (isFilled) {

                ctx.fillRect(
                    -def.width / 2,
                    -def.height / 2,
                    def.width,
                    def.height
                );

            } else {

                ctx.strokeRect(
                    -def.width / 2,
                    -def.height / 2,
                    def.width,
                    def.height
                );
            }

            break;
    }
}


// ====================================================================
// TRAITS DE CALIBRATION
// ====================================================================

function drawCalibrationTicks(
    ctx,
    left,
    top,
    right,
    bottom,
    color
) {

    ctx.save();

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    const tickLength = 18;

    // Haut
    drawTick(
        ctx,
        (left + right) / 2,
        top,
        0,
        tickLength
    );

    // Bas
    drawTick(
        ctx,
        (left + right) / 2,
        bottom,
        0,
        -tickLength
    );

    // Gauche
    drawTick(
        ctx,
        left,
        (top + bottom) / 2,
        tickLength,
        0
    );

    // Droite
    drawTick(
        ctx,
        right,
        (top + bottom) / 2,
        -tickLength,
        0
    );

    ctx.restore();
}


function drawTick(
    ctx,
    x,
    y,
    dx,
    dy
) {

    ctx.beginPath();

    ctx.moveTo(
        x,
        y
    );

    ctx.lineTo(
        x + dx,
        y + dy
    );

    ctx.stroke();
}


module.exports = sealRenderer;