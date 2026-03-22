# Setup Instructions - Run the Full Stack Locally

## ✅ Completed Steps
- ✅ Generated Prisma Client
- ✅ Configured environment variables

## 📋 Next Steps

### Step 1: Create PostgreSQL Databases

You need to create two databases. Choose your method:

#### Option A: Using Command Line (Windows)
Run this in PowerShell/Command Prompt (adjust `postgres` username if different):

```powershell
psql -U postgres -h localhost -c "CREATE DATABASE abc_platform;"
psql -U postgres -h localhost -c "CREATE DATABASE abc;"
```

#### Option B: Using pgAdmin or PostgreSQL GUI
1. Open pgAdmin or PostgreSQL administration tool
2. Create two databases:
   - `abc_platform` (for Platform API)
   - `abc` (for Evolution API)

#### Option C: Using Docker (if PostgreSQL isn't installed)
```powershell
docker run -d `
  -e POSTGRES_PASSWORD=postgres `
  -e POSTGRES_USER=postgres `
  -p 5432:5432 `
  --name postgres-blink `
  postgres:latest
```

Then create the databases:
```powershell
docker exec -it postgres-blink psql -U postgres -c "CREATE DATABASE abc_platform;"
docker exec -it postgres-blink psql -U postgres -c "CREATE DATABASE abc;"
```

---

### Step 2: Verify Configuration Files

✅ **Root `.env` file** is set up at:
- Path: `C:\Users\Doodle-Admin\Downloads\Telegram Desktop\testing\testing\.env`
- Contains: `DATABASE_URL` for Platform API database

✅ **Evolution API `.env` file** is set up at:
- Path: `.\\evolution-api-lite\\.env`
- Contains: `DATABASE_CONNECTION_URI` for Evolution API database

**If your PostgreSQL username/password is NOT `postgres:postgres`, update these files accordingly.**

---

### Step 3: Run Database Migrations (Platform API)

Once the `abc_platform` database is created:

```powershell
cd "C:\Users\Doodle-Admin\Downloads\Telegram Desktop\testing\testing"
npm run db:migrate
```

This will:
- Run all Prisma migrations for the Platform API
- Create tables for users, workspaces, products, quotations, etc.

---

### Step 4: Start Services (3 Terminal Windows)

You need to run these in **separate terminal windows** so all services run simultaneously.

#### Terminal 1: Evolution API (Port 8080)
```powershell
cd "C:\Users\Doodle-Admin\Downloads\Telegram Desktop\testing\testing\evolution-api-lite"
npm start
```

**Expected output:**
```
Repository:Prisma - ON
HTTP - ON: 8080
```

---

#### Terminal 2: Platform API (Port 4000)
```powershell
cd "C:\Users\Doodle-Admin\Downloads\Telegram Desktop\testing\testing"
npm run dev:api
```

**Expected output:**
```
@blink/api listening on http://localhost:4000
```

---

#### Terminal 3: Web Dashboard (Port 3000)
```powershell
cd "C:\Users\Doodle-Admin\Downloads\Telegram Desktop\testing\testing"
npm run dev:web
```

**Expected output:**
```
Local: http://localhost:3000
```

---

## 🎯 Access the Application

Once all three services are running:

1. **Web Dashboard**: Open [http://localhost:3000/login](http://localhost:3000/login)
2. **Register a new user** (email, password, full name)
3. The backend will create a default workspace/customer for this user

---

## 🔗 Service Architecture

| Service | Port | Purpose |
|---------|------|---------|
| Evolution API | 8080 | WhatsApp integration & message transport |
| Platform API | 4000 | REST API for dashboard & business logic |
| Web Dashboard | 3000 | Next.js frontend UI |
| PostgreSQL | 5432 | Two databases: `abc_platform` & `abc` |

---

## ⚠️ Troubleshooting

### "address already in use :::4000"
Another process is using port 4000. Kill it:
```powershell
$process = Get-Process | Where-Object { $_.Name -eq "node" }
Stop-Process -Id $process.Id -Force
```

### Database connection errors
- Verify PostgreSQL is running: `psql -U postgres -h localhost`
- Check DATABASE_URL in `.env` files
- Ensure databases `abc_platform` and `abc` exist

### Prisma migration failed
```powershell
npm run db:migrate -- --skip-necessary
```

---

## 📝 Next: Connect WhatsApp

After setup, go to **Dashboard → WhatsApp** to:
1. Set your business profile
2. Create/refresh WhatsApp Instance
3. Scan QR code from phone

