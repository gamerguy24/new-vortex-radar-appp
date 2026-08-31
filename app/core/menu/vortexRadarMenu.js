const ut = require('../utils');
const createMenuOption = require('./createMenuOption');

const showHideDuration = 250;
function showARMwindow() {
    $('#vortexRadarMenu').fadeIn(showHideDuration);
    $('#vortexRadarMenuContainer').hide().show('slide', { direction: 'down' }, showHideDuration);
}
function hideARMwindow() {
    $('#vortexRadarMenu').fadeOut(showHideDuration);
    $('#vortexRadarMenuContainer').hide('slide', { direction: 'down' }, showHideDuration, function() {
        $('#vortexRadarMenu').hide();

        $('.armScreen').hide();
        $('#vortexRadarMenuMainScreen').show();
    });
}

// createMenuOption({
//     'divId': 'offcanvasMenuItemDiv',
//     'iconId': 'offcanvasMenuItemIcon',

//     'divClass': 'mapFooterMenuItem',
//     'iconClass': 'icon-grey',

//     'location': 'top-left',
//     'size': 30,

//     'contents': 'Open Offcanvas Menu',
//     'icon': 'fa fa-bars',
//     'css': ''
// }, function(divElem, iconElem) {
//     showARMwindow();

//     $('#vortexRadarMenuSettingsScreen').hide();
//     $('#vortexRadarMenuMainScreen').show();
// })

// provided by ChatGPT
$.fn.rotateArrow = function (degrees, easing, duration) {
    return this.each(function () {
        var el = $(this);
        var currentRotation = getRotationDegrees(el);
        var finalRotation = currentRotation + degrees;
        el.animate({
            deg: finalRotation
        }, {
            duration: duration,
            easing: easing,
            step: function (now) {
                el.css({
                    transform: "rotate(" + now + "deg)"
                });
            }
        });
    });
};
function getRotationDegrees(el) {
    var st = window.getComputedStyle(el[0], null);
    var tr = st.getPropertyValue("-webkit-transform") ||
        st.getPropertyValue("-moz-transform") ||
        st.getPropertyValue("-ms-transform") ||
        st.getPropertyValue("-o-transform") ||
        st.getPropertyValue("transform");
    if (tr == 'none') return 0;
    var values = tr.split('(')[1].split(')')[0].split(',');
    var a = values[0];
    var b = values[1];
    var angle = Math.round(Math.atan2(b, a) * (180 / Math.PI));
    return (angle < 0 ? angle + 360 : angle);
}

$('#vortexRadarMenu').on('click', function(e) {
    var clickedTarget = $(e.target).attr('id');
    if (clickedTarget == 'vortexRadarMenu'/* || clickedTarget == 'atcDlgClose'*/) {
        hideARMwindow();
        //$(this).hide();
    }
})
$('.armsHeaderExitBtn').click(function() {
    hideARMwindow();
    //$('#vortexRadarMenu').hide();
})

function slideDownToggle(armrElem, armrSlideDownElem) {
    const duration = 150;
    const easing = 'swing';
    var arrow = armrElem.find('.armrIconArrowRight');
    var toggleswitch = armrSlideDownElem.find('.toggleSwitchContainter');

    if (arrow.data('rotationStatus') == 'normal' || arrow.data('rotationStatus') == undefined) {
        armrElem.addClass('armrTop');
        if (toggleswitch.length) { toggleswitch.hide().fadeIn(duration / 1.5) }
        armrSlideDownElem.slideDown(duration);
        arrow.rotateArrow(90, easing, duration);
        arrow.data('rotationStatus', 'down');
    } else {
        if (toggleswitch.length) { toggleswitch.fadeOut(duration / 1.5) }
        armrSlideDownElem.slideUp(duration, function() {
            armrElem.removeClass('armrTop');
        });
        arrow.rotateArrow(-90, easing, duration);
        arrow.data('rotationStatus', 'normal');
    }
}

function toggleswitchFunctions(switchElem, onFunction, offFunction, onclick_function = function() {}) {
    // you can't use .click() because it fires twice for some reason
    switchElem.on('click', function(e) {
        var checkbox = $(this); //.find('input');
        var isChecked = checkbox.is(':checked'); // true if the switch just turned on
        if (isChecked) { onFunction.apply(this, []); }
        else { offFunction.apply(this, []); }

        onclick_function.apply(this, []);
    })
}

$('.armrSlideDown').hover(function() {
    $(this).css('background-color', 'rgb(60, 60, 60)');
    $(this).css('cursor', 'default');
})

const fadeDuration = 150;

var mainMenuScreen = '#vortexRadarMenuMainScreen';
var settingsScreen = '#vortexRadarMenuSettingsScreen';
// SPC Outlooks became three screens — Severe, Tropical and Fire — each
// reachable from TOOLS. severeScreen is the old spcScreen renamed, so the
// convective tables inside it are untouched.
var severeScreen = '#vortexRadarMenuSevereScreen';
var tropicalScreen = '#vortexRadarMenuTropicalScreen';
var fireScreen = '#vortexRadarMenuFireScreen';

// The three occupy the same slot, so opening one must hide the others —
// otherwise a previously-opened screen shows through underneath.
function hideCategoryScreens(done) {
    $(severeScreen).hide();
    $(tropicalScreen).hide();
    $(fireScreen).hide();
    if (done) done();
}
var dealiasScreen = '#vortexRadarMenuDealiasScreen';
var colortablesScreen = '#vortexRadarMenuColortablesScreen';

$('#armrSettingsBtn').click(function() {
    $(mainMenuScreen).fadeOut(fadeDuration, function() {
        hideCategoryScreens(function() {
            $(settingsScreen).scrollTop(0).fadeIn(fadeDuration);
        });
    });
    // mainMenuScreen.css('position', 'absolute').hide('slide', { direction: 'left' }, 1000);
    // settingsScreen.show('slide', { direction: 'right' }, 1000);
    // mainMenuScreen.hide()
    // settingsScreen.show('slide', { direction: 'right' }, 1000, function() {
    //     setTimeout(function() {
    //         settingsScreen.fadeOut(200);
    //     }, 200)
    // });
    // mainMenuScreen.hide('slide', { direction: 'left' }, 1000, function() {
    //     settingsScreen.show('slide', { direction: 'right' }, 1000);
    // });
})
$('#armsSettingsBackBtn').click(function() {
    $(settingsScreen).fadeOut(fadeDuration, function() {
        hideCategoryScreens(function() {
            $(mainMenuScreen).scrollTop(0).fadeIn(fadeDuration);
        });
    });
})

/*
 * Severe, Tropical and Fire share one open-and-close shape, so they share one
 * pair of helpers rather than three near-identical copies of the old SPC
 * handler. Each is reached from TOOLS and returns to the main menu.
 */
function openCategoryScreen(screen) {
    $(mainMenuScreen).fadeOut(fadeDuration, function() {
        $(settingsScreen).fadeOut(fadeDuration, function() {
            hideCategoryScreens();
            $(screen).scrollTop(0).fadeIn(fadeDuration);
        });
    });
}
function closeCategoryScreen(screen) {
    $(screen).fadeOut(fadeDuration, function() {
        $(mainMenuScreen).scrollTop(0).fadeIn(fadeDuration);
    });
}

$('#armrSevereBtn').click(function() { openCategoryScreen(severeScreen); })
$('#armsSevereBackBtn').click(function() { closeCategoryScreen(severeScreen); })

$('#armrTropicalBtn').click(function() { openCategoryScreen(tropicalScreen); })
$('#armsTropicalBackBtn').click(function() { closeCategoryScreen(tropicalScreen); })

$('#armrFireBtn').click(function() { openCategoryScreen(fireScreen); })
$('#armsFireBackBtn').click(function() { closeCategoryScreen(fireScreen); })

$('#armrDealiasSettingsBtn').click(function() {
    $(mainMenuScreen).fadeOut(fadeDuration, function() {
        $(settingsScreen).fadeOut(fadeDuration, function() {
            $(dealiasScreen).scrollTop(0).fadeIn(fadeDuration);
        });
    });
})
$('#armsDealiasBackBtn').click(function() {
    $(mainMenuScreen).fadeOut(fadeDuration, function() {
        $(dealiasScreen).fadeOut(fadeDuration, function() {
            $(settingsScreen).scrollTop(0).fadeIn(fadeDuration);
        });
    });
})

$('#armrColortablesBtn').click(function() {
    $(mainMenuScreen).fadeOut(fadeDuration, function() {
        $(settingsScreen).fadeOut(fadeDuration, function() {
            $(colortablesScreen).fadeIn(fadeDuration);
        });
    });
})
$('#armsColortablesBackBtn').click(function() {
    $(settingsScreen).fadeOut(fadeDuration, function() {
        $(colortablesScreen).fadeOut(fadeDuration, function() {
            $(mainMenuScreen).scrollTop(0).fadeIn(fadeDuration);
        });
    });
})

module.exports = {
    slideDownToggle,
    toggleswitchFunctions,
    showARMwindow,
    hideARMwindow
}