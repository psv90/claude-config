# CODE-REVIEW - Mody Claude

Rejestr błędów projektu. Najnowsze na górze. Statusy: `otwarty`, `naprawiony`, `porzucony`.

<!-- Format wpisu:
## RRRR-MM-DD · krótki tytuł · otwarty
- **Gdzie:** plik:linia (albo ekran/funkcja)
- **Objaw:** co widać / co się psuje
- **Przyczyna:** dlaczego
- **Naprawa:** co zmieniłem
-->

## 2026-10-25 · agenci: validate odrzucał przekazanie $ do funkcji · naprawiony
- **Gdzie:** plugins/agenci/hooks/register.tsx (`refresh`)
- **Objaw:** `plugin validate` - błąd „$ is passed to refresh, which is not a function declared at the top of this file”.
- **Przyczyna:** `refresh($)` był zadeklarowany wewnątrz `register`; walidator śledzi `$` tylko do funkcji z najwyższego poziomu pliku.
- **Naprawa:** `refresh` przeniesiony na najwyższy poziom modułu.

_Brak wpisów._
