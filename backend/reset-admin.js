require('dotenv').config();
const pool = require('./database');
const bcrypt = require('bcryptjs');

async function resetAdmin() {
    try {
        console.log('Generating secure hash...');
        const plainPassword = 'admin123';
        const hash = await bcrypt.hash(plainPassword, 10);
        
        console.log('Updating Supabase Database...');
        // This will create the user if missing, or update the password if they exist
        const query = `
            INSERT INTO users (name, email, password, role) 
            VALUES ('Super Admin', 'admin@studio.com', $1, 'Admin')
            ON CONFLICT (email) 
            DO UPDATE SET password = $1;
        `;
        
        await pool.query(query,[hash]);
        
        console.log('✅ Admin account ready!');
        console.log('📧 Email: admin@studio.com');
        console.log('🔑 Password: admin123');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error resetting admin:', err.message);
        process.exit(1);
    }
}

resetAdmin();
