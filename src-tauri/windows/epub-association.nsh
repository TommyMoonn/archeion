; Register an optional viewer without touching the extension default or UserChoice.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\Archeion.epub" "" "EPUB eBook"
  WriteRegStr SHCTX "Software\Classes\Archeion.epub\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\Classes\Archeion.epub\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr SHCTX "Software\Classes\.epub\OpenWithProgids" "Archeion.epub" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".epub" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ReadRegStr $R0 SHCTX "Software\Classes\Archeion.epub\shell\open\command" ""
  ${If} $R0 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
    DeleteRegKey SHCTX "Software\Classes\Archeion.epub"
    DeleteRegValue SHCTX "Software\Classes\.epub\OpenWithProgids" "Archeion.epub"
    DeleteRegKey /ifempty SHCTX "Software\Classes\.epub\OpenWithProgids"
    DeleteRegValue SHCTX "Software\Classes\.epub" "Archeion.epub_backup"
    ; Remove a legacy default only when it points to the removed handler.
    ReadRegStr $R0 SHCTX "Software\Classes\.epub" ""
    ${If} $R0 == "Archeion.epub"
      DeleteRegValue SHCTX "Software\Classes\.epub" ""
    ${EndIf}
  ${EndIf}
  ReadRegStr $R0 SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" ""
  ${If} $R0 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
    DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  ${EndIf}
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
