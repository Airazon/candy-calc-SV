(function(){
var curves;
const CANDY_SIZES = [ 'XS', 'S', 'M', 'L', 'XL' ];
const calcExpToLvl = ( curve, n ) => ( n <= 1 ) ? 0 : curves[ curve ]( n );
const clamp = ( num, lb, ub ) => Math.max( lb, Math.min( num, ub ) );
const toCamel = ( str ) => str.toLowerCase().replace( /\s+([a-z])/g, ( _, chr ) => chr.toUpperCase() );

curves = {
    fast: function( n ) {
        return Math.floor( Math.pow( n, 3 ) * 4 / 5 );
    },
    slow: function( n ) {
        return Math.floor( Math.pow( n, 3 ) * 5 / 4 );
    },
    mediumFast: function( n ) {
        return Math.pow( n, 3 );
    },
    mediumSlow: function( n ) {
        return Math.floor( Math.pow( n, 3 ) * 6 / 5 - Math.pow( n, 2 ) * 15 + n * 100 - 140 );
    },
    erratic: function( n ) {
        if ( n < 50 ) {
            return Math.floor( Math.pow( n, 3 ) * ( 100 - n ) / 50 );
        } else if ( 50 <= n && n <= 68 ) {
            return Math.floor( Math.pow( n, 3 ) * ( 150 - n ) / 100 );
        } else if ( 68 < n && n < 98 ) {
            return Math.floor( Math.pow( n, 3 ) * ( 1911 - n * 10 ) / 1500 );
        } else {
            return Math.floor( Math.pow( n, 3 ) * ( 160 - n ) / 100 );
        }
    },
    fluctuating: function( n ) {
        if ( n < 15 ) {
            return Math.floor( Math.pow( n, 3 ) * ( 73 + n ) / 150 );
        } else if ( 15 <= n && n < 36 ) {
            return Math.floor( Math.pow( n, 3 ) * ( 14 + n ) / 50 );
        } else {
            return Math.floor( Math.pow( n, 3 ) * ( 64 + n ) / 100 );
        }
    }
}

function validate() {
    var disable = false;
    if ( !( $( 'input[name=curve]' ).val().length ) ) {
        disable = true;
    } else if ( parseInt( $( 'input[name=target]' ).val() ) < parseInt( $( 'input[name=current]' ).val() ) ) {
        disable = true;
    }
    $( '[type=submit]' ).prop( 'disabled', disable );
}

function output( value, start ) {
    var now = new Date();
    var d = ( now.getTime() - start.getTime() ) / 1000;
    if ( d > 60 ) throw new Error( 'timeout' );
    console.log( value );
}

function optimize( problem ) {
    var lp, iocp, start, colname, colval, objval;

    start = new Date();

    lp = glp_create_prob();
    glp_read_lp_from_string( lp, null, problem );

    glp_scale_prob( lp, GLP_SF_AUTO );

    iocp = new IOCP( { presolve: GLP_ON } );
    glp_intopt( lp, iocp );

    objval = glp_mip_obj_val( lp );
    output( 'obj: ' + objval, start );
    for( let i = 1; i <= glp_get_num_cols( lp ); i++ ){
        colname = glp_get_col_name( lp, i ),
        colval = glp_mip_col_val( lp, i );
        output( colname  + ' = ' + colval, start );
        $( '#result-exp-candy-' + colname ).val( colval );
        objval -= colval;
    }
    return objval;
}

$( document ).ready(function() {
    var i, len, template, $template;

    // read candy MILP problem
    $.get('https://raw.githubusercontent.com/richi3f/candy-calc/master/candy.txt', function( problemTemplate ) {

        // read Pokémon names and experience curves
        $.getJSON( 'https://plan.pokemonteams.io/static/pokemon.json', function( pokemonData ) {
            var slug, slugs;

            // add an option to the datalist for each Pokémon
            slugs = Object.keys( pokemonData );
            len = slugs.length;
            for ( i = 0; i < len; i++ ) {
                slug = slugs[ i ];
                if ( pokemonData[ slug ].dex.swsh == 999 ) {
                    continue;
                }
                $( '<option>' )
                    .attr( 'value', pokemonData[ slug ].name )
                    .attr( 'data-exp-curve', pokemonData[ slug ].exp )
                    .appendTo( 'datalist' );
            }
            
            // show the experience curve when a Pokémon name is typed
            $( '#pokemon' ).on( 'input', function() {
                var value;
                value = this.value;
                if ( $( 'datalist option' ).filter(function() {
                    return this.value.toUpperCase() == value.toUpperCase();
                }).length ) {
                    value = $( 'datalist option[value="' + value + '"]' ).attr( 'data-exp-curve' );
                    $( 'input[name=curve]' ).val( value );
                } else {
                    $( 'input[name=curve]' ).val( '' );
                }
                validate();
            });
        });

        // create rows for candy in bag
        template = $('#candyrow').html().trim();
        len = CANDY_SIZES.length;
        for ( i = 0; i < len; i++ ) {
            let slug = 'exp-candy-' + CANDY_SIZES[ i ].toLowerCase();
            $template = $( template );
            $template.find( 'label' )
                .attr( 'for', slug )
                .text( 'Exp. Candy ' + CANDY_SIZES[ i ] );
            $template.find( 'input[type=number]' )
                .attr( 'id', slug )
                .attr( 'name', slug );
            $template.find( 'input[readonly]' )
                    .attr( 'id', 'result-' + slug );
            $template.appendTo( 'form table tbody' );
        }

        // limit numerical input
        $( 'input[type=number]' ).on( 'change', function() {
            var value, $this;
            value = parseInt( this.value );
            $this = $( this );
            if ( !isNaN( value ) ) {
                value = clamp( value, $this.attr('min'), $this.attr('max') );
                $this.val( value );
            } else {
                $this.val( $this.attr('min') );
            }
            validate();
        });

        // calculate optimal candy distribution
        $( 'form' ).on( 'submit', function( evt ) {
            var expDiff, expCurrent, expTarget, curve, values, problem;
            values = {};
            evt.preventDefault();
            $.each( $( 'form' ).serializeArray(), function( _, field ) {
                values[ field.name ] = field.value;
            });
            curve = toCamel( values.curve );
            expCurrent = calcExpToLvl( curve, values.current );
            expTarget = calcExpToLvl( curve, values.target );
            expDiff = expTarget - expCurrent;
            
            problem = problemTemplate.replace( /{exp}/g, expDiff );
            len = CANDY_SIZES.length;
            for ( i = 0; i < len; i++ ) {
                let size = CANDY_SIZES[ i ].toLowerCase();
                problem = problem.replace( RegExp( '{' + size + '}' ), values[ 'exp-candy-' + size ]);
            }

            expCurrent = optimize( problem );
            expDiff = expCurrent - expTarget;
            console.log( 'surplus = ' + expDiff );
        });

        validate();

    }, 'text');
});

})();