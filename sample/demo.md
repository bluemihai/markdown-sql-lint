# Demo: SQL linting in Markdown

This block is valid — no squiggles expected:

```sql
CREATE TABLE type (
    id SERIAL PRIMARY KEY,
    code TEXT,
    description TEXT
);

INSERT INTO agent(badge_number, name)
VALUES
    (71717, 'Mik'),
    (43293, 'Kamiel');
```

This block has a dangling comma — expect a squiggle on `FROM`:

```sql
SELECT id,
FROM users;
```

This one has a typo'd keyword — expect a squiggle on `SELEC`:

```sql
SELECT 1;
SELEC 2;
```

Unclosed parenthesis — expect an error at the semicolon:

```sql
INSERT INTO location (street, city, postal_code
VALUES ('425 Phillips Pine', 'Susanmouth', 'MI 20522');
```

Style suggestions (blue, not red — and a lightbulb quick fix where safe):

```sql
select id, name
from agent
```

```sql
SELECT * FROM incident;
```

Non-SQL fences are ignored:

```python
this is not sql and should not be linted
```
