# Globalne instrukcje — Olek

## Środowisko
- System: Windows. Ścieżki, komendy i skrypty pisz pod Windows (PowerShell), chyba że projekt mówi inaczej.
- Często buduję samodzielne narzędzia: pojedyncze pliki HTML, skrypty Python, aplikacje desktopowe, skrypty AutoHotkey v2, rozszerzenia Chrome (Manifest V3).

## Kod modułowy - nic nie piszę dwa razy
- Dotyczy każdego projektu i języka (JS/TS, Python, AutoHotkey, wtyczki Chrome), nie tylko interfejsu.
- Zanim napiszę funkcję, sprawdzam, czy projekt już ma taką lub podobną. Jeśli tak - używam jej (w razie potrzeby rozszerzam o parametr), zamiast pisać drugą.
- Gdy ten sam lub prawie ten sam kod potrzebny jest w drugim miejscu, najpierw wydzielam go do wspólnego modułu (np. `lib/`, `utils/`, `shared/`, osobny plik `.ahk` dołączany przez `#Include`), przepinam pierwsze miejsce i dopiero wtedy używam w drugim.
- Jeden moduł = jedna odpowiedzialność (np. zapis do bazy, wywołanie API, formatowanie dat). Stałe i konfiguracja w jednym miejscu, nie rozsiane po plikach.
- Przy poprawce błędu we wspólnym kodzie poprawiam go raz, w module - nie łatam kopii.
- Ta sama funkcja interfejsu w różnych miejscach projektu (drag and drop, color picker, modal, potwierdzenie usuwania, dropdown, tooltip, wyszukiwarka, toast itp.) ma wyglądać tak samo, działać tak samo i korzystać z tego samego kodu.

## Pobieranie kodu z internetu - tylko za zgodą
- NIGDY nie pobieraj z własnej inicjatywy nieznanych repozytoriów ani kodu z GitHuba, GitLaba, Bitbucketa, Hugging Face, gistów, pastebinów, forów ani innych serwisów (`git clone`, `gh repo clone`, `curl`/`wget`/`Invoke-WebRequest` archiwów i skryptów, `npx`/`pipx run`/`uvx` z adresu repo, `pip install git+...`, `npm install <url-repo>`, `npx skills add ...` itp.).
- Jeśli takie pobranie jest naprawdę potrzebne: zatrzymaj się i zapytaj mnie. W pytaniu podaj: co dokładnie (adres), po co, kto to utrzymuje (gwiazdki, ostatni commit, jeśli wiesz) i czy jest alternatywa bez pobierania. Pobieraj dopiero po moim wyraźnym „tak”, a zgoda dotyczy tylko tego jednego repozytorium.
- Nie dotyczy: instalowania zależności z oficjalnych rejestrów, które projekt już ma w `package.json`/`requirements.txt` (`npm install`, `pip install -r`), oraz czytania stron i dokumentacji bez pobierania i uruchamiania kodu. Nowa paczka spoza projektu to osobna decyzja - też pytam.

## Rejestr błędów (CODE-REVIEW.md)
- Każdy projekt ma w katalogu głównym `CODE-REVIEW.md`: każdy znaleziony błąd wpisuję od razu (`otwarty` → `naprawiony`/`porzucony` z powodem), najnowsze na górze, wpisów nie kasuję, przed pracą czytam otwarte. Format:
  ```
  ## RRRR-MM-DD · krótki tytuł
  - **Status:** otwarty / naprawiony / porzucony (powód)
  - **Gdzie:** plik:linia (albo ekran/funkcja)
  - **Objaw:** co widać / co się psuje
  - **Przyczyna:** dlaczego
  - **Naprawa:** co zmieniłem (data, jeśli inna niż wpisu)
  ```

## Projekty webowe
- Stack: React / Next.js + Tailwind CSS.
- Interfejs ma być piękny i mocno animowany (wiele animowanych elementów). Gotowe biblioteki komponentów i animacji (np. interior.dev, Motion) są mile widziane.
- Dźwięki interfejsu: kliknięcia, dźwięki przy animacjach itp.
- Typografia jest ważna: mieszaj kroje z różnych rodzin — szeryfowy z bezszeryfowym, gruby z cienkim, ozdobny ze stonowanym.
- Przy proponowaniu wyglądu pokazuj kilka mock-upów różnych kierunków do wyboru. Robię to równolegle: kierunek A buduję sam, a kierunki B i C zlecam forkom (narzędzie Agent, `subagent_type: "fork"`), wysłanym w jednej wiadomości. Każdy fork dostaje w zleceniu nazwę i opis swojego kierunku (np. „brutalistyczny, szeryf + mono, ostre kontrasty”), plik wyjściowy (np. `mockup-b.html`) i polecenie, żeby nie dotykał innych plików. Gdy rozmowa jest już bardzo długa, zamiast forka używam general-purpose z pełnym briefem.
- Gdy forki skończą B i C, łączę wszystkie kierunki (A, B, C) w jeden plik `mockupy.html` z przełącznikiem kierunków na górze, żeby porównywać je w jednym oknie. Każdy kierunek ma własny zakres stylów (bez przecieków CSS między nimi). Oddaję i pokazuję ten jeden plik; osobne `mockup-a/b/c.html` mogą zostać jako źródło.
- Po zbudowaniu lub większej zmianie interfejsu uruchamiam subagenta `straznik-ui` na zmienionych plikach i poprawiam to, co zgłosi, zanim oddam pracę.
- Po zbudowaniu strony albo większej przebudowie wyglądu zawsze proponuję tryb live (wybieranie wariantów elementów w przeglądarce) jednym zdaniem na końcu odpowiedzi. Nie uruchamiam go bez mojej zgody. Instrukcja i szablony DESIGN.md skilli: `C:\Users\aleks\.claude\skills\_wspolne\tryb-live.md`.

### Twarde zasady UI
- Wszystko, co da się usunąć, ZAWSZE wymaga potwierdzenia — w tym samym miejscu co przycisk usuwania (żeby mysz nie musiała daleko jechać).
- Przyciski akcji (edytuj, usuń itp.) pojawiają się tylko po najechaniu myszą i nie zajmują miejsca w layoucie (nakładka przez z-index).
- NIGDY nie używaj kolorowego paska akcentu na lewej krawędzi kart/boksów/wierszy (border-left stripe).
- W ciemnych UI cały tekst musi być wyraźnie czytelny — żadnych przygaszonych szarych/szaroniebieskich etykiet i wartości na prawie czarnym tle.