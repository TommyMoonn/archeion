; Tauri's APP_ASSOCIATE creates an EPUB ProgID but makes it the default.
; Preserve the existing default and register Archeion as an Open with option.
Var EpubPreviousDefault
Var EpubHadDefault

!macro NSIS_HOOK_PREINSTALL
  ClearErrors
  ReadRegStr $EpubPreviousDefault SHCTX "Software\Classes\.epub" ""
  ${If} ${Errors}
    StrCpy $EpubHadDefault 0
  ${Else}
    StrCpy $EpubHadDefault 1
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $EpubHadDefault = 1
    WriteRegStr SHCTX "Software\Classes\.epub" "" "$EpubPreviousDefault"
  ${Else}
    DeleteRegValue SHCTX "Software\Classes\.epub" ""
  ${EndIf}

  ; Quote the executable path in Tauri's generated ProgID command too.
  WriteRegStr SHCTX "Software\Classes\Archeion.epub\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\Classes\Archeion.epub\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr SHCTX "Software\Classes\.epub\OpenWithProgids" "Archeion.epub" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".epub" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  !insertmacro UPDATEFILEASSOC
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; APP_UNASSOCIATE restores its install-time backup. Keep a default that
  ; the user may have selected after installing Archeion.
  ClearErrors
  ReadRegStr $EpubPreviousDefault SHCTX "Software\Classes\.epub" ""
  ${If} ${Errors}
    StrCpy $EpubHadDefault 0
  ${Else}
    StrCpy $EpubHadDefault 1
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $EpubHadDefault = 0
    DeleteRegValue SHCTX "Software\Classes\.epub" ""
  ${ElseIf} $EpubPreviousDefault != "Archeion.epub"
    WriteRegStr SHCTX "Software\Classes\.epub" "" "$EpubPreviousDefault"
  ${EndIf}

  DeleteRegValue SHCTX "Software\Classes\.epub\OpenWithProgids" "Archeion.epub"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.epub\OpenWithProgids"
  DeleteRegValue SHCTX "Software\Classes\.epub" "Archeion.epub_backup"

  ReadRegStr $R0 SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" ""
  ${If} $R0 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
    DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  ${EndIf}
  !insertmacro UPDATEFILEASSOC
!macroend
