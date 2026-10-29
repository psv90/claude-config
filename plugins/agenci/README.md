# agenci

Pasek nad promptem, który pokazuje działających agentów: subagentów z narzędzia Agent, teammates i agentów odpalonych przez inne mody.

- Wiersz na agenta: kropka stanu, typ, zadanie, bieżąca czynność (ostatnie narzędzie) i czas pracy.
- Najwyżej 4 wiersze, reszta jako „+N więcej”.
- Skończony agent zostaje 5 s z ✓ (albo ✗), potem znika. Bez agentów paska nie ma.
- Zero tokenów: dane z `$.agent.list()`, odświeżane co sekundę tylko wtedy, gdy jakiś agent żyje.
