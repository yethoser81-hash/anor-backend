// ==========================================
// ANOR V16 • Compositeur Géométrique de Sceaux
// ==========================================

class Compositeur {
    static composer(signatureHex, options = {}) {
        const glyphes = [];
        const nbFormes = 64; // Densité des glyphes sur les orbites concentriques
        
        // RÈGLE VALIDÉE : Point de repère unique sous forme de TRIANGLE positionné strictement à 12H 
        // dans le premier cercle concentrique (Rayon 110 pour correspondre à l'orbite interne)
        glyphes.push({
            forme: 'triangle_top',
            rayon: 110, 
            angle: -Math.PI / 2, // Position exacte à 12H (Haut du cercle)
            plein: true,
            taille: 'fixed'
        });

        // Utilisation de la signature pour générer des variations déterministes (en partant de i = 1)
        for (let i = 1; i < nbFormes; i++) {
            const hexPair = signatureHex.substring((i * 2) % (signatureHex.length - 2), ((i * 2) % (signatureHex.length - 2)) + 2);
            const val = parseInt(hexPair, 16);

            // Distribution sur plusieurs anneaux concentriques (du centre vers l'extérieur : de 110 à 210)
            const rayonMin = 110;
            const rayonMax = 210;
            const rayon = rayonMin + (val % (rayonMax - rayonMin));
            
            // Angle réparti circulairement avec une dérive pseudo-aléatoire
            const angle = (i / nbFormes) * 2 * Math.PI + (val * 0.01);

            // Alternance stricte formes pleines / vides et types de formes variées (excluant le triangle réservé à 12H)
            const types = ['rect_long', 'rect_court', 'circle', 'diamond', 'plus', 'square'];
            const typeIndex = val % types.length;
            const formeType = types[typeIndex];
            
            const plein = (val % 2 === 0); // Alternance 50% plein / 50% vide

            let tailleDefinie = 'medium';
            if (formeType === 'rect_long') tailleDefinie = 'long';
            if (formeType === 'rect_court') tailleDefinie = 'short';

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