function display_vortex_dialog(options) {
    var title = options.title;
    var body = options.body;
    var color = options.color;
    var textColor = options.textColor;

    $('#atcDlg').show();

    $('#atcDlgHeaderText').html(title);
    $('#atcDlgHeader').css('background-color', color);
    //$('#vortexDialogHeaderContainer').css('background-color', color);
    $('#atcDlgHeader').css('color', textColor);
    $('#atcDlgClose').css('color', textColor);

    $('#atcDlgBody').scrollTop(0);
    $('#atcDlgBody').html(body);

    // const headerHeight = $('#vortexDialogHeaderContainer').height();
    // var contentHeight = 0;
    // $('#vortexDialogBody').children().each(function() { contentHeight = contentHeight + $(this).height() })
    //$('#vortexDialogContainer').height(headerHeight + contentHeight);
    // var bodyHeight = $('#vortexDialogBody').outerHeight();
    // console.log(bodyHeight)
    // $('#vortexDialogContainer').height(bodyHeight);
}

$('#atcDlg').on('click', function(e) {
    var clickedTarget = $(e.target).attr('id');
    if (clickedTarget == 'atcDlg' || clickedTarget == 'atcDlgClose') {
        $(this).hide();
    }
})

module.exports = display_vortex_dialog;