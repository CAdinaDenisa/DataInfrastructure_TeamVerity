-- =====================================================================
-- Acces pentru identitatea Function App (Managed Identity) în Azure SQL.
-- Rulează-l O SINGURĂ DATĂ, logat ca administrator Microsoft Entra al serverului SQL,
-- conectat la baza aplicației (telemetrydb), DUPĂ migrări.
--
-- Variante:
--   a) automat:  npm run db:migrate -- --grant-app <functionAppName>   (din src/backend/api, după az login)
--   b) manual:   înlocuiește REPLACE_WITH_FUNCTION_APP_NAME și rulează în VS Code (extensia MSSQL)
--
-- Aplicația primește doar ce îi trebuie: citire, inserare și actualizare în schema dbo.
-- NU primește DELETE și nici drepturi de modificare a schemei (migrările le rulează un om).
-- =====================================================================
IF DB_NAME() = N'master'
    THROW 51000, 'Conectează-te la baza aplicației (ex. telemetrydb), nu la master.', 1;

IF OBJECT_ID(N'dbo.batches', N'U') IS NULL
    THROW 51001, 'Rulează întâi migrările (npm run db:migrate).', 1;

DECLARE @FunctionAppName sysname = N'REPLACE_WITH_FUNCTION_APP_NAME';

IF @FunctionAppName = N'REPLACE_WITH_FUNCTION_APP_NAME'
    THROW 51002, 'Înlocuiește numele Function App (output-ul functionAppName din Bicep).', 1;

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = @FunctionAppName)
BEGIN
    DECLARE @CreateUserSql nvarchar(max) = N'CREATE USER ' + QUOTENAME(@FunctionAppName) + N' FROM EXTERNAL PROVIDER;';
    EXEC sys.sp_executesql @CreateUserSql;
END;

DECLARE @GrantSql nvarchar(max) =
    N'GRANT CONNECT TO ' + QUOTENAME(@FunctionAppName) + N'; ' +
    N'GRANT SELECT, INSERT, UPDATE ON SCHEMA::dbo TO ' + QUOTENAME(@FunctionAppName) + N';';
EXEC sys.sp_executesql @GrantSql;

SELECT name, type_desc FROM sys.database_principals WHERE name = @FunctionAppName;
