# Final backend update apne VS Code mein lagana

1. Purane backend ke terminal mein `Ctrl + C` se server band karo.
2. Purane project folder aur MongoDB data ka backup rakho.
3. Final ZIP ko **naye folder** mein extract karo; us ka `jobboard_backend` folder VS Code mein kholo.
4. Purane folder se apni `.env` file aur `uploads` folder naye backend mein copy karo. Apni asli `.env` ko example file se replace mat karna.
5. Naye terminal mein:

```bash
npm ci --ignore-scripts
npm run dev
```

MongoDB Server running rehna chahiye. Wohi MONGODB_URI/JWT secret aur uploads se existing data use hoga; database delete/reset nahi karna. Naye local configuration options ke defaults already hain.

Purane tokens ke bajaye dobara login karna hoga. Existing accounts ke liye email verification required hai. Local development emails private preview files mein aati hain; real inbox delivery SMTP configure karne ke baad hogi. Frontend verification/reset screens integration ke waqt banengi.

**Nayi jobs ab administrator approval ke baad public directory mein dikhengi.** Apne verified active account ko trusted host command se admin banana documented hai:

```bash
npm run admin:grant -- --email your-verified-email@example.com
```

Frontend abhi alag kaam hai. Backend ke admin/dashboard/notification endpoints tayyar hain; admin UI is ZIP mein nahi. Production providers/hosting ke liye docs/deployment.md aur .env.production.example dekho; local use ke liye unki zaroorat nahi.

Manual API tests abhi karna zaroori nahi. Automated checks already chalaye gaye hain. Final planned backend code ek isi ZIP mein hai.
