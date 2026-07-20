// ==========================================
// ANOR V16 • Compositeur Géométrique de Sceaux
// ==========================================

class Compositeur {
    static composer(signatureHex, options = {}) {
        const glyphes = [];
        const nbFormes = 64; // Densité des glyphes sur les orbites concentriques
        
        // Point de départ de lecture (Ancrage) positionné tout près du médaillon central
        glyphes.push({
            forme: 'anchor_start',
            rayon: 95, // Proche du centre (médaillon rayon ~75-85)
            angle: 0,
            plein: true,
            taille: 'small'
        });

        // Utilisation de la signature pour générer des variations déterministes
        for (let i = 1; i < nbFormes; i++) {
            const hexPair = signatureHex.substring((i * 2) % (signatureHex.length - 2), ((i * 2) % (signatureHex.length - 2)) + 2);
            const val = parseInt(hexPair, 16);

            // Distribution sur plusieurs anneaux concentriques (du centre vers l'extérieur : de 110 à 210)
            const rayonMin = 110;
            const rayonMax = 210;
            const rayon = rayonMin + (val % (rayonMax - rayonMin));
            
            // Angle réparti circulairement avec une dérive pseudo-aléatoire
            const angle = (i / nbFormes) * 2 * Math.PI + (val * 0.01);

            // Alternance stricte formes pleines / vides et types de formes variées
            const types = ['rect_long', 'rect_court', 'circle', 'diamond', 'plus', 'square'];
            const typeIndex = val % types.length;
            const formeType = types[typeIndex];
            
            const plein = (val % 2 === 0); // Alternance 50% plein / 50% vide

            let tailleDefinie = 'medium';
            if (formeType === 'rect_long') tailleDefinie = 'long';
            if (formeType === 'rect_court') tailleDefinise = 'short';

            glyphes.push({
                forme: formeType,
                rayon: rayon,
                angle: angle,
                plein: plein,
                taille: tailleDefinie
            });
        }

        return glyphes;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Compositeur;
}