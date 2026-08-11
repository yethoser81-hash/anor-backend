/**
 * ======================================================
 * SYSTEME SOUVERAIN DE CERTIFICATION ANOR - SERVER CORE
 * Version: 17.6.0
 * ======================================================
 */

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");require("dotenv").config();
const JSZip = require("jszip");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");

// ======================================================
// VERSION / CONFIGURATION
// ======================================================

const SERVER_VERSION = "17.6.0";
const VISUAL_VERSION = 1;
const VISUAL_BITS_LENGTH = 51;
const isProduction =
    process.env.NODE_ENV === "production";

// ======================================================
// MODULES ANOR
// ======================================================

const supabase =    require("./config/database");
const SealRenderer =    require("./engine/sealRenderer");
const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");

// ======================================================
// UTILITAIRES VISUAL MATRIX
// ======================================================

function normalizeVisualBits(bits) {
    if (        typeof bits === "string" &&
        /^[01]{51}$/.test(bits)
    ) {        return bits;    }

    return null;}

function sha256Hex(value) {    return crypto
        .createHash("sha256")
        .update(String(value))
        .digest("hex");
}

function calculateHammingDistance(    str1,    str2
) {

    if (        typeof str1 !== "string" ||
        typeof str2 !== "string" ||
        str1.length !== str2.length
    ) {        return Infinity;    }

    let distance = 0;

    for (        let i = 0;
        i < str1.length;
        i++
    ) {

        if (            str1[i] !== str2[i]
        ) {            distance++;        }
    }
    return distance;}

function sanitizeFileName(filename) {
    if (!filename) {
        return "unnamed_file";    }

    return String(filename)
        .replace(
            /[^a-zA-Z0-9._-]/g,
            "_"
        );}


function isValidUserAgent(agent) {
    return (        typeof agent === "string" &&
        agent.length > 0 &&
        agent.length <= 400
    );}

// ======================================================
// UPLOAD
// ======================================================

const upload = multer({
    limits: {        fileSize:
            10 * 1024 * 1024
    },

    fileFilter: (        req,        file,
        cb
    ) => {
        const allowedMimes = [
            "application/pdf",
            "image/jpeg",
            "image/png",
            "image/webp"
        ];

        if (            allowedMimes.includes(
                file.mimetype            )
        ) {
            return cb(                null,                true            );
        }

        return cb(            new Error(                "INVALID_FILE_TYPE"            )
        );
    }});

// ======================================================
// CORS
// ======================================================

const allowedOrigins = [

    "http://localhost:3000",
    "https://anor-backend.onrender.com",
    "capacitor://localhost",
    "http://localhost",
    "https://localhost"
];


app.use(
    cors({
        origin: function (            origin,            callback
        ) {
            if (!origin) {
                return callback(                    null,                    true                );
            }

            const isLocalDevIP =
                /^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}):\d+$/
                    .test(origin);

            if (                allowedOrigins.includes(
                    origin
                ) ||
                isLocalDevIP ||
                !isProduction
            ) {
                return callback(
                    null,
                    true
                );
            }

            return callback(                new Error(
                    "Bloqué par la politique CORS (NotSameOrigin)"
                )
            );        },

        credentials: true,

        methods: [   "GET",    "POST",    "PUT",    "DELETE",     "OPTIONS"        ],

        allowedHeaders: [   "Content-Type",   "Authorization",    "X-API-Version",  "X-Request-Id"    ]
    }));

// ======================================================
// SECURITE
// ======================================================

app.use(
    helmet({        crossOriginEmbedderPolicy:            false,
        contentSecurityPolicy:            false
    })
);

app.use(    express.json({        limit: "10mb"    }));
app.use(    express.urlencoded({        extended: true,        limit: "10mb"    }));
app.use(   (        req,        res,        next    ) => {

        res.setHeader(            "Content-Security-Policy",
            "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';"
        );
        res.setHeader(            "X-Content-Type-Options",
            "nosniff"
        );
        res.setHeader(            "X-Frame-Options",
            "DENY"
        );

        res.setHeader(            "X-XSS-Protection",
            "1; mode=block"
        );

        res.setHeader(            "Referrer-Policy",
            "strict-origin-when-cross-origin"        );
        next();
    });

// ======================================================
// REQUEST ID / LOGGING
// ======================================================

app.use(
    (        req,        res,        next    ) => {

        const startTime =            Date.now();

        const requestId =            req.headers[                "x-request-id"            ] ||
            crypto.randomUUID();

        req.requestId =            requestId;
        res.setHeader(            "X-Request-Id",            requestId        );
        res.on(            "finish",            () => {

                if (!isProduction) {   const duration =   Date.now() -     startTime;

                    console.log(     `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms) [ID: ${requestId}]`
                    );
                }
            }        );

        next();
    });

// ======================================================
// RATE LIMIT SCAN
// ======================================================

const scanLimiter =    rateLimit({
        windowMs:
            60 * 1000,
        max: 60,
        standardHeaders:
            true,
        legacyHeaders:
            false,
        message: {
            status: 429,
            error:
                "TROP_DE_REQUETES",
            message:
                "Trop de requêtes de scan de ce périphérique. Veuillez ralentir."
        }    });

// ======================================================
// ANTI-REPLAY
// ======================================================

const recentRequests =    new Map();
const REQUEST_TTL =    30000;
const MAX_RECENT_REQUESTS =    10000;

setInterval(    () => {
        const now =            Date.now();
        for (            const [                id,                time            ]
            of recentRequests.entries()
        ) {
            if (
                now - time >                REQUEST_TTL            ) {
                recentRequests.delete(                    id                );            }
        }    },
    10000);

app.use(    (        req,        res,        next    ) => {

        if (    [     "GET",      "HEAD",      "OPTIONS"    ].includes(
                req.method            )
        ) {
            return next();
        }
        const id =  req.headers[   "x-request-id"  ];
        if (!id) {            return next();        }
        const replayKey =            `${req.method}:${req.path}:${id}`;
        if (            recentRequests.has(                replayKey            )        ) {

            return apiError(    res,    409,   "DUPLICATE_REQUEST",  "Cette requête a déjà été traitée."
            );        }

        if (            recentRequests.size >=            MAX_RECENT_REQUESTS        ) {

            const oldestKey =                recentRequests
                    .keys()
                    .next()
                    .value;

            if (oldestKey) {                recentRequests.delete(                    oldestKey
                );
            }        }

        recentRequests.set(            replayKey,            Date.now()        );
        next();
    });

// ======================================================
// REPONSES API
// ======================================================

function apiSuccess(    res,    data = {},    status = 200) {    return res        .status(status)
        .json({
            success: true,
            requestId:
                res.getHeader(                    "X-Request-Id"
                ) ||
                res.req?.headers[
                    "x-request-id"
                ] ||
                null,

            timestamp:
                Date.now(),

            ...data
        });
}


function apiError(
    res,
    status = 500,
    code = "SERVER_ERROR",
    message =
        "Une erreur est survenue.",
    details = null
) {

    const payload = {

        success: false,

        error: {

            code,

            message
        },

        timestamp:
            Date.now()
    };

    if (details) {

        payload.error.details =
            details;
    }

    return res
        .status(status)
        .json(payload);
}


function securityLog(
    req,
    event,
    details = {}
) {

    console.warn(
        JSON.stringify({

            time:
                new Date()
                    .toISOString(),

            requestId:
                req.headers[
                    "x-request-id"
                ] ||
                req.requestId ||
                null,

            ip:
                req.ip,

            event,

            details
        })
    );
}


// ======================================================
// ANALYSE VISUELLE
// ======================================================

async function intelligentVisualAnalysis(
    scannedMatrix
) {

    if (!scannedMatrix) {

        return {

            lot: null,

            signature: null,

            bits: null,

            confidence: 0
        };
    }


    // --------------------------------------------------
    // FORMAT STRING
    // --------------------------------------------------

    if (
        typeof scannedMatrix ===
        "string"
    ) {

        const trimmed =
            scannedMatrix.trim();


        if (!trimmed) {

            return {

                lot: null,

                signature: null,

                bits: null,

                confidence: 0
            };
        }


        // ANOR51:xxxxxxxx...
        if (
            trimmed.startsWith(
                "ANOR51:"
            )
        ) {

            const bits =
                normalizeVisualBits(
                    trimmed.substring(
                        7
                    )
                );

            if (bits) {

                return {

                    lot: null,

                    signature:
                        trimmed,

                    bits,

                    confidence:
                        0.90
                };
            }
        }


        // 51 bits directs
        const directBits =
            normalizeVisualBits(
                trimmed
            );

        if (directBits) {

            return {

                lot: null,

                signature:
                    `ANOR51:${directBits}`,

                bits:
                    directBits,

                confidence:
                    0.90
            };
        }


        // Compatibilité lot manuel
        if (
            trimmed.length < 50
        ) {

            return {

                lot:
                    trimmed,

                signature:
                    null,

                bits:
                    null,

                confidence:
                    0.95
            };
        }


        return {

            lot: null,

            signature:
                trimmed,

            bits:
                null,

            confidence:
                0.50
        };
    }


    // --------------------------------------------------
    // FORMAT OBJET
    // --------------------------------------------------

    if (
        typeof scannedMatrix ===
        "object"
    ) {

        const bits =
            normalizeVisualBits(

                scannedMatrix.bits ||
                scannedMatrix.visualBits
            );


        const signature =
            scannedMatrix.signature ||
            scannedMatrix.visualSignature ||
            null;


        const lot =
            scannedMatrix.lot ||
            scannedMatrix.batch ||
            scannedMatrix.certificate_code ||
            null;


        return {

            lot,

            signature,

            bits,

            confidence:
                bits
                    ? 0.90
                    : lot
                        ? 0.95
                        : 0.40
        };
    }


    return {

        lot: null,

        signature: null,

        bits: null,

        confidence: 0
    };
}


// ======================================================
// FICHIERS STATIQUES
// ======================================================

app.use(
    express.static(
        __dirname
    )
);


app.get(
    [
        "/",
        "/index.html"
    ],
    (
        req,
        res
    ) => {

        res.sendFile(
            path.join(
                __dirname,
                "index.html"
            )
        );
    }
);


// ======================================================
// HEALTH
// ======================================================

app.get(
    "/health",
    async (
        req,
        res
    ) => {

        let database =
            "DOWN";

        try {

            const {
                error
            } =
                await supabase
                    .from(
                        "produits_certifies"
                    )
                    .select(
                        "lot"
                    )
                    .limit(1);

            if (!error) {

                database =
                    "UP";
            }

        } catch (error) {

            database =
                "DOWN";
        }

        return apiSuccess(
            res,
            {

                status:
                    "ONLINE",

                engine:
                    `ANOR Core ${SERVER_VERSION}`,

                database,

                uptime:
                    process.uptime(),

                memory:
                    process.memoryUsage()
                        .rss,

                node:
                    process.version
            }
        );
    }
);


// ======================================================
// GENERATION DU SCEAU
// ======================================================

app.post(
    "/api/seals/generate-batch-seal",

    upload.fields([

        {
            name:
                "certificat_pdf",

            maxCount:
                1
        },

        {
            name:
                "visuel_produit",

            maxCount:
                1
        },

        {
            name:
                "pdf",

            maxCount:
                1
        },

        {
            name:
                "visuel",

            maxCount:
                1
        },

        {
            name:
                "image",

            maxCount:
                1
        }
    ]),

    async (
        req,
        res
    ) => {

        const startTime =
            Date.now();

        try {

            const {

                nom_produit,

                nom_producteur,

                lot,

                quantite,

                type_emballage,

                composition,

                pays_origine,

                date_certificat_conformite,

                date_fabrication,

                date_peremption

            } = req.body;


            // --------------------------------------------------
            // VALIDATION
            // --------------------------------------------------

            if (
                !lot ||
                !quantite ||
                !type_emballage
            ) {

                return apiError(
                    res,
                    400,
                    "MISSING_PARAMETERS",
                    "Les champs lot, quantite et type_emballage sont obligatoires."
                );
            }


            const parsedQuantite =
                Number.parseInt(
                    quantite,
                    10
                );


            if (
                !Number.isInteger(
                    parsedQuantite
                ) ||
                parsedQuantite <= 0
            ) {

                return apiError(
                    res,
                    400,
                    "INVALID_QUANTITY",
                    "La quantité doit être un nombre entier positif."
                );
            }


            // --------------------------------------------------
            // FICHIERS
            // --------------------------------------------------

            const files =
                req.files || {};


            const pdfFile =
                files.certificat_pdf?.[0] ||
                files.pdf?.[0] ||
                null;


            const visuelFile =
                files.visuel_produit?.[0] ||
                files.visuel?.[0] ||
                files.image?.[0] ||
                null;


            const pdfBufferData =
                pdfFile
                    ? {

                        buffer:
                            pdfFile.buffer,

                        mimetype:
                            pdfFile.mimetype,

                        originalname:
                            pdfFile.originalname

                    }
                    : null;


            const visuelBufferData =
                visuelFile
                    ? {

                        buffer:
                            visuelFile.buffer,

                        mimetype:
                            visuelFile.mimetype,

                        originalname:
                            visuelFile.originalname

                    }
                    : null;


            const certificateCode =
                String(lot);


            // --------------------------------------------------
            // SIGNATURE CRYPTOGRAPHIQUE
            // --------------------------------------------------

            const secureSignature =
                crypto
                    .createHash(
                        "sha256"
                    )
                    .update(
                        `${certificateCode}-${Date.now()}-${crypto.randomUUID()}`
                    )
                    .digest(
                        "hex"
                    );


            // --------------------------------------------------
            // MATRICE 51 BITS
            // --------------------------------------------------

            const visualBits =
                normalizeVisualBits(

                    SealRenderer
                        .deriveVisualBits(
                            secureSignature
                        )
                );


            if (!visualBits) {

                throw new Error(
                    `La matrice visuelle ANOR doit contenir exactement ${VISUAL_BITS_LENGTH} bits.`
                );
            }


            const visualSignature =
                `ANOR51:${visualBits}`;


            // --------------------------------------------------
            // RENDU DU SCEAU
            // --------------------------------------------------

            const imageBuffer =                await SealRenderer                    .renderSealToBuffer(

                        {         secureSignature,                            visualBits                        },

                        {
                            lot,
                            quantite:
                                parsedQuantite,
                            type_emballage,
                            productName:
                                nom_produit,
                            nom_produit,
                            nom_producteur,
                            isMasterSeal:
                                true,
                            masterSerialLabel:
                                `SÉRIE : DM / ${parsedQuantite.toLocaleString(
                                    "fr-FR"
                                )}`
                        }                    );


            if (                !Buffer.isBuffer(                    imageBuffer                )
            ) {
                throw new Error(
                    "Le renderer n'a pas renvoyé un Buffer valide."                );
            }

            const rawBase64 =                imageBuffer      .toString(      "base64"     )
                    .replace(                        /\r|\n/g,                        ""                    );

            // --------------------------------------------------
            // STORAGE
            // --------------------------------------------------

            let pdfUrl =                null;
            let visuelUrl =                null;

            // PDF
            if (pdfBufferData) {
                try {
                    const pdfPath =         `${Date.now()}_${sanitizeFileName(                            pdfBufferData.originalname                        )}`;
                    const {        data: pdfData,         error: pdfErr                    } =
                        await supabase
                            .storage
                            .from(                                "certificat-pdf"                            )
                            .upload(        pdfPath,                                pdfBufferData.buffer,

                                {           contentType:         pdfBufferData.mimetype,

                                    upsert:                                        true                                }
                            );

                    if (                        !pdfErr &&                        pdfData                    ) {

                        const {     data:      publicUrlData                        } =
                            supabase
                                .storage
                                .from(       "certificat-pdf"                                )
                                .getPublicUrl(                                    pdfPath                                );

                        pdfUrl =      publicUrlData             ?.publicUrl ||
                            null;                    }

                } catch (
                    storageError
                ) {

                    console.warn(
                        "⚠️ Exception Storage PDF :",
                        storageError.message
                    );
                }

                if (!pdfUrl) {
                    pdfUrl =
                        `data:${pdfBufferData.mimetype};base64,${pdfBufferData.buffer.toString(
                            "base64"
                        )}`;
                }            }

            // VISUEL
            if (visuelBufferData) {
                try {
                    const visuelPath =
                        `${Date.now()}_${sanitizeFileName(                            visuelBufferData.originalname
                        )}`;
                    const {                        data:                            visuelData,
                        error:
                            visuelErr
                    } =
                        await supabase
                            .storage
                            .from(                                "Produits"                            )
                            .upload(
                                visuelPath,
                                visuelBufferData.buffer,

                                {                                    contentType:
                                        visuelBufferData.mimetype,
                                    upsert:
                                        true
                                }
                            );

                    if (                        !visuelErr &&                        visuelData
                    ) {
                        const {
                            data:                                publicUrlData
                        } =                            supabase
                                .storage
                                .from(                                    "Produits"                                )
                                .getPublicUrl(                                    visuelPath                                );

                        visuelUrl =                            publicUrlData
                                ?.publicUrl ||
                            null;                    }

                } catch (                    storageError                ) {

                    console.warn(
                        "⚠️ Exception Storage Visuel :",
                        storageError.message                    );                }

                if (!visuelUrl) {
                    visuelUrl =
                        `data:${visuelBufferData.mimetype};base64,${visuelBufferData.buffer.toString(
                            "base64"                        )}`;
                }            }

            // --------------------------------------------------
            // PAYLOAD DATABASE
            // --------------------------------------------------

            const payloadDB = {                certificate_code:
                    certificateCode,
                lot,
                quantite:
                    parsedQuantite,
                type_emballage,
                nom_produit:
                    nom_produit ||
                    null,
                nom_producteur:
                    nom_producteur ||
                    null,
                composition:
                    composition ||
                    null,
                pays_origine:
                    pays_origine ||
                    null,
                date_certificat_conformite:
                    date_certificat_conformite ||
                    null,
                date_fabrication:
                    date_fabrication ||
                    null,
                date_peremption:
                    date_peremption ||
                    null,
                certificat_pdf_url:
                    pdfUrl,
                visuel_produit_url:
                    visuelUrl,

                // ------------------------------------------
                // MATRICE VISUELLE CANONIQUE
                // ------------------------------------------

                glyph_payload: {
                    visualVersion:                        VISUAL_VERSION,

                    secureSignature,
                    lot,
                    visualBits,
                    visualSignature
                },

                visual_version:                    VISUAL_VERSION,
                visual_bits:                    visualBits,
                visual_signature:                    visualSignature,
                matrix_hash:                    sha256Hex(                        visualBits                    ),
                ai_signature_hash:                    secureSignature,
                sha256_hash:                    secureSignature,
                signature_ia:                    secureSignature,
                visual_geometry: {
                    inner:                        7,
                    middle:                        24,
                    outer:                        20,
                    total:                        51                },

                engine_version:                    SERVER_VERSION,
                statut:                    "CERTIFIÉ",
                scan_count:                    0            };

            const {                data,                error
            } =                await supabase
                    .from(                        "produits_certifies"                    )
                    .upsert(                        payloadDB,

                        {                            onConflict:
                                "lot"                        }
                    )
                    .select();

            if (error) {                throw error;            }


            // --------------------------------------------------
            // NOTICE ZIP
            // --------------------------------------------------

            const printNoticeContent = `

1. IDENTIFICATION DU LOT ET DU PRODUIT :

   - Numéro de Lot       : ${lot}
   - Nom du Produit     : ${nom_produit || "N/A"}
   - Producteur         : ${nom_producteur || "N/A"}
   - Quantité certifiée : ${parsedQuantite.toLocaleString(
       "fr-FR"
   )} unités
   - Type d'emballage   : ${type_emballage}


2. CONSIGNES TECHNIQUES D'IMPRESSION DU SCEAU :

   - Le fichier 'sceau_ANOR_MASTER.png' inclus dans ce paquet est la matrice Mère.
   - Impression recommandée : Quadrichromie haute résolution (300 DPI minimum).
   - Dimensions minimales du glyph central : 15mm x 15mm pour garantir la lecture.


Fait à Yaoundé, le ${new Date().toLocaleDateString(
                "fr-FR"
            )}

Système Souverain de Certification - ANOR Engine ${SERVER_VERSION}

================================================================================
`;


            const zip =
                new JSZip();


            zip.file(                "NOTICE_DIMPRESSION_ET_INSTRUCTIONS.txt",
                printNoticeContent
            );

            zip.file(                "certification.json",
                JSON.stringify(

                    {
                        lot,
                        nom_produit,
                        nom_producteur,
                        quantite:
                            parsedQuantite,
                        visualVersion:
                            VISUAL_VERSION,
                        visualBits,
                        visualSignature,
                        signature_ia:
                            secureSignature,
                        created_at:
                            new Date()
                                .toISOString()                    },

                    null,
                    4
                )            );

            zip.file(                "sceau_ANOR_MASTER.png",
                imageBuffer            );

            const zipBuffer =                await zip
                    .generateAsync({
                        type:                            "nodebuffer",
                        compression:                            "DEFLATE",
                        compressionOptions: {                            level:                                9
                        }                    });

            // --------------------------------------------------
            // REPONSE
            // --------------------------------------------------

            return apiSuccess(                res,

                {
                    message:                        "Sceau généré avec succès.",
                    lot,
                    sha256_hash:                        secureSignature,
                    visualVersion:                        VISUAL_VERSION,
                    visualBits,
                    visualSignature,
                    imageUrl:                        `data:image/png;base64,${rawBase64}`,
                    zipUrl:                        `data:application/zip;base64,${zipBuffer.toString(
                            "base64"                        )}`,

                    data:
                        data?.[0] ||
                        null,
                    processingTimeMs:
                        Date.now() -
                        startTime                },

                200            );

        } catch (error) {            console.error(
                "❌ Erreur Forge Backend Directe:",
                error            );

            return apiError(
                res,
                500,
                "FORGE_ERROR",
                error.message
            );        }
    });

// ======================================================
// VERIFICATION DU SCEAU
// ======================================================

app.post(
    "/api/seals/verify",
    scanLimiter,
    async (        req,        res
    ) => {
        const startTime =            Date.now();
        try {

            // --------------------------------------------------
            // VALIDATION CLIENT
            // --------------------------------------------------

            if (  !isValidUserAgent(   req.headers[   "user-agent"    ]   )
            ) {
                securityLog(
                    req,
                    "INVALID_USER_AGENT"                );
                return apiError(
                    res,
                    400,
                    "INVALID_CLIENT",
                    "Client non valide."                );            }

            const {
                scannedMatrix,
                lot,
                location,
                locationMethod,
                deviceMetadata
            } = req.body;

            if (                !lot &&                !scannedMatrix
            ) {
                return apiError(
                    res,
                    400,
                    "MISSING_SCAN",
                    "Données de scan insuffisantes."
                );
            }


            let row =
                null;


            let verificationMode =
                "LOT";


            let matchConfidence =
                1.0;


            // ==================================================
            // 1. RECHERCHE EXACTE PAR LOT
            // ==================================================

            if (lot) {

                const cleanLot =
                    String(
                        lot
                    ).trim();


                const {
                    data,
                    error
                } =
                    await supabase
                        .from(
                            "produits_certifies"
                        )
                        .select(
                            "*"
                        )
                        .ilike(
                            "lot",
                            cleanLot
                        )
                        .maybeSingle();


                if (
                    !error &&
                    data
                ) {

                    row =
                        data;
                }
            }


            // ==================================================
            // 2. ANALYSE VISUELLE
            // ==================================================

            if (
                !row &&
                scannedMatrix
            ) {

                verificationMode =
                    "INTELLIGENT_VISUAL_SCAN";


                const analysis =
                    await intelligentVisualAnalysis(
                        scannedMatrix
                    );


                // ------------------------------------------------
                // 2A. LOT DETECTE
                // ------------------------------------------------

                if (
                    analysis.lot
                ) {

                    const {
                        data
                    } =
                        await supabase
                            .from(
                                "produits_certifies"
                            )
                            .select(
                                "*"
                            )
                            .ilike(
                                "lot",
                                String(
                                    analysis.lot
                                ).trim()
                            )
                            .maybeSingle();


                    if (data) {

                        row =
                            data;

                        verificationMode =
                            "VISUAL_LOT_EXACT";

                        matchConfidence =
                            Math.max(
                                0,
                                Math.min(
                                    1,
                                    analysis.confidence ||
                                        0
                                )
                            );
                    }
                }


                // ------------------------------------------------
                // 2B. SIGNATURE ANOR51 EXACTE
                // ------------------------------------------------

                if (
                    !row &&
                    analysis.signature
                ) {

                    const {
                        data
                    } =
                        await supabase
                            .from(
                                "produits_certifies"
                            )
                            .select(
                                "*"
                            )
                            .eq(
                                "visual_signature",
                                analysis.signature
                            )
                            .maybeSingle();


                    if (data) {

                        row =
                            data;

                        matchConfidence =
                            0.99;

                        verificationMode =
                            "VISUAL_SIGNATURE_EXACT";
                    }
                }


                // ------------------------------------------------
                // 2C. HAMMING 51 BITS
                // ------------------------------------------------

                if (
                    !row &&
                    analysis.bits
                ) {

                    const normalizedBits =
                        normalizeVisualBits(
                            analysis.bits
                        );


                    if (
                        normalizedBits
                    ) {

                        const {
                            data:
                                candidates,
                            error
                        } =
                            await supabase
                                .from(
                                    "produits_certifies"
                                )
                                .select(
                                    "*"
                                )
                                .not(
                                    "visual_bits",
                                    "is",
                                    null
                                )
                                .limit(
                                    500
                                );


                        if (
                            !error &&
                            candidates &&
                            candidates.length
                        ) {

                            let bestMatch =
                                null;


                            let bestDistance =
                                Infinity;


                            for (
                                const candidate
                                of candidates
                            ) {

                                const target =
                                    normalizeVisualBits(
                                        candidate.visual_bits
                                    );


                                if (
                                    !target
                                ) {

                                    continue;
                                }


                                const distance =
                                    calculateHammingDistance(
                                        normalizedBits,
                                        target
                                    );


                                if (
                                    distance <
                                    bestDistance
                                ) {

                                    bestDistance =
                                        distance;

                                    bestMatch =
                                        candidate;
                                }
                            }


                            /*
                             * 51 bits :
                             *
                             * Quelques erreurs sont tolérées
                             * pour lumière, impression, perspective
                             * et compression caméra.
                             */

                            const MAX_VISUAL_ERRORS =
                                6;


                            if (
                                bestMatch &&
                                bestDistance <=
                                    MAX_VISUAL_ERRORS
                            ) {

                                row =
                                    bestMatch;


                                matchConfidence =
                                    Number(

                                        (
                                            1 -
                                            bestDistance /
                                                VISUAL_BITS_LENGTH
                                        ).toFixed(
                                            3
                                        )
                                    );


                                verificationMode =
                                    "VISUAL_HAMMING_MATCH";
                            }
                        }
                    }
                }
            }


            // ==================================================
            // 3. AUCUN MATCH = REJET
            // ==================================================

            if (!row) {

                securityLog(

                    req,

                    "UNKNOWN_SEAL_ATTEMPT",

                    {

                        lot:
                            lot ||
                            "N/A"
                    }
                );


                return apiError(

                    res,

                    404,

                    "UNKNOWN_SEAL",

                    "Sceau inconnu ou non authentifié.",

                    {

                        status:
                            "CONTREFAÇON_REJETEE",

                        processingTime:
                            Date.now() -
                            startTime,

                        engineVersion:
                            SERVER_VERSION
                    }
                );
            }


            // ==================================================
            // 4. ENREGISTREMENT DU SCAN
            // ==================================================

            const currentScanCount =
                Number(
                    row.scan_count ||
                    0
                ) + 1;


            const currentLocation =
                location ||
                "Inconnue";


            let warningFlag =
                null;


            if (

                row.last_scan_location &&

                row.last_scan_location !==
                    currentLocation &&

                row.last_scanned_at

            ) {

                const timeDiffMinutes =

                    (
                        Date.now() -
                        new Date(
                            row.last_scanned_at
                        ).getTime()
                    ) /
                    (1000 * 60);


                if (
                    timeDiffMinutes <
                    15
                ) {

                    warningFlag =
                        "SUSPICION_DUPLICATION_SCEAU";
                }
            }


            const updatePayload = {

                scan_count:
                    currentScanCount,

                last_scan_location:
                    currentLocation,

                location_method:
                    locationMethod ||
                    null,

                last_scanned_at:
                    new Date()
            };


            if (
                deviceMetadata
            ) {

                updatePayload.device_metadata =
                    deviceMetadata;
            }


            // Mise à jour non bloquante
            supabase

                .from(
                    "produits_certifies"
                )

                .update(
                    updatePayload
                )

                .eq(
                    "lot",
                    row.lot
                )

                .then(
                    ({
                        error:
                            updateError
                    }) => {

                        if (
                            updateError
                        ) {

                            console.warn(
                                "⚠️ Mise à jour scan échouée:",
                                updateError.message
                            );
                        }
                    }
                )

                .catch(
                    updateError => {

                        console.warn(
                            "⚠️ Exception mise à jour scan:",
                            updateError.message
                        );
                    }
                );


            // ==================================================
            // 5. REPONSE AUTHENTIQUE
            // ==================================================

            const score =
                `${(
                    matchConfidence *
                    100
                ).toFixed(1)}%`;
            return apiSuccess(
                res,
                {
                    status:                        "AUTHENTIQUE",
                    verified:                        true,
                    confidence:                        matchConfidence,                    score,
                    confidenceScore:                        matchConfidence,
                    security_alert:                        warningFlag,
                    securityAlert:                        warningFlag,
                    lot:                        row.lot,
                    batch:                        row.lot,
                    nom_produit:                        row.nom_produit ||                        "Produit Certifié Conforme",
                    nomProduit:                        row.nom_produit ||                        "Produit Certifié Conforme",
                    nom_producteur:                        row.nom_producteur ||                        "Producteur Agréé",
                    nomProducteur:                        row.nom_producteur ||                        "Producteur Agréé",
                    pays:                        row.pays_origine ||                        "Cameroun",
                    pays_origine:                        row.pays_origine ||                        "Cameroun",
                    quantite:                        row.quantite,
                    type_emballage:                        row.type_emballage,
                    typeEmballage:                        row.type_emballage,
                    composition:                        row.composition ||                        null,
                    packaging:                        row.type_emballage ||                        null,
                    visualUrl:                        row.visuel_produit_url ||                        null,
                    visuel_produit_url:                        row.visuel_produit_url ||                        null,
                    visualProduitUrl:                        row.visuel_produit_url ||                        null,
                    certificat_pdf_url:                        row.certificat_pdf_url ||                        null,
                    certificatPdfUrl:                        row.certificat_pdf_url ||                        null,
                    scan_count:                        currentScanCount,
                    scanCount:                        currentScanCount,
                    certified_at:                        row.created_at ||                        row.date_certificat_conformite,
                    certDate:                        row.date_certificat_conformite ||                        row.created_at,
                    prodDate:                        row.date_fabrication ||                        "N/A",
                    expDate:                        row.date_peremption ||                        "N/A",
                    norme:                        "ANOR NC-ISO",
                    processingTime:                        Date.now() -                        startTime,
                    processingTimeMs:                        Date.now() -                        startTime,
                    engineVersion:                        SERVER_VERSION,
                    visualVersion:                        VISUAL_VERSION,
                    verificationMode,
                    serverTimestamp:                        Date.now()
                }            );

        } catch (error) {
            console.error(
                "❌ Erreur vérification:",
                error            );

            return apiError(
                res,
                500,
                "SERVER_ERROR",
                "Erreur interne pendant la vérification."
            );
        }
    }
);


// ======================================================
// FEEDBACK / TELEMETRIE
// ======================================================

app.post(

    "/api/seals/feedback",

    scanLimiter,

    async (
        req,
        res
    ) => {

        try {

            const {

                lot,
                luminance,
                isLowLight,
                contrastScore,
                rawFrameSnippet
            } = req.body;


            const safeSnippet =
                typeof rawFrameSnippet ===
                "string"
                    ? rawFrameSnippet.substring(
                        0,
                        500
                    )

                    : null;


            const {
                error
            } =
                await supabase

                    .from(
                        "telemetrie_scans"
                    )

                    .insert([{

                        lot:                            lot ||                            "INCONNU",
                        luminance:
                            typeof luminance ===
                            "number"
                                ? luminance
                                : null,
                        is_low_light:
                            !!isLowLight,
                        contrast_score:
                            typeof contrastScore ===
                            "number"
                                ? contrastScore
                                : null,

                        frame_snippet:
                            safeSnippet,

                        created_at:
                            new Date()
                    }]);


            if (error) {

                throw error;
            }


            return apiSuccess(

                res,

                {

                    adaptiveParameters: {

                        recommendedLightBoost:
                            !!isLowLight
                    },

                    message:
                        "Télémétrie intégrée avec succès."
                }
            );

        } catch (error) {

            return apiError(

                res,

                500,

                "TELEMETRY_ERROR",

                "Échec d'enregistrement de la télémétrie."
            );
        }
    }
);


// ======================================================
// ERREURS MULTER / SERVEUR
// ======================================================

app.use(

    (
        err,
        req,
        res,
        next
    ) => {

        if (
            err &&
            err.message ===
                "INVALID_FILE_TYPE"
        ) {

            return apiError(

                res,

                400,

                "INVALID_FILE_TYPE",

                "Le format de fichier téléversé n'est pas autorisé."
            );
        }


        if (
            err &&
            err.code ===
                "LIMIT_FILE_SIZE"
        ) {

            return apiError(

                res,

                413,

                "FILE_TOO_LARGE",

                "Le fichier dépasse la taille maximale autorisée de 10 MB."
            );
        }


        console.error(
            "❌ Middleware erreur:",
            err
        );


        return apiError(

            res,

            500,

            "SERVER_ERROR",

            "Erreur interne du serveur."
        );
    }
);


// ======================================================
// ROUTE 404
// ======================================================

app.use(
    (
        req,
        res
    ) => {

        return apiError(

            res,

            404,

            "ROUTE_NOT_FOUND",

            "Route inexistante."
        );
    }
);


// ======================================================
// DEMARRAGE
// ======================================================

const PORT =
    process.env.PORT ||
    10000;


const server =
    app.listen(

        PORT,

        "0.0.0.0",

        () => {

            console.log(

                `[EXPERT BACKEND] Serveur Souverain ANOR v${SERVER_VERSION} prêt sur http://0.0.0.0:${PORT}`

            );
        }
    );


// ======================================================
// ARRET PROPRE
// ======================================================

function shutdown(
    signal
) {

    console.log(
        `[ANOR] Arrêt demandé (${signal}).`
    );


    server.close(
        () => {

            process.exit(
                0
            );
        }
    );
}


process.on(
    "SIGINT",
    () => shutdown("SIGINT")
);


process.on(
    "SIGTERM",
    () => shutdown("SIGTERM")
);


// ======================================================
// GC OPTIONNEL
// ======================================================

if (global.gc) {

    setInterval(

        () => {

            try {

                global.gc();

            } catch (error) {

                // GC optionnel.
            }
        },

        600000
    );
}