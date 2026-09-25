import java.io.*;
import java.nio.file.*;
import java.util.zip.*;

public class ApkPacker {
    public static void main(String[] args) {
        if (args.length < 4) {
            System.err.println("Usage: ApkPacker <baseApk> <assetsDir> <dexFile> <outputApk>");
            System.exit(1);
        }

        File baseApk = new File(args[0]);
        File assetsDir = new File(args[1]);
        File dexFile = new File(args[2]);
        File outputApk = new File(args[3]);

        try {
            pack(baseApk, assetsDir, dexFile, outputApk);
            System.out.println("ApkPacker: Successfully created " + outputApk.getAbsolutePath());
        } catch (Exception e) {
            e.printStackTrace();
            System.exit(1);
        }
    }

    public static void pack(File baseApk, File assetsDir, File dexFile, File outputApk) throws Exception {
        if (outputApk.exists()) outputApk.delete();

        try (ZipFile zipFile = new ZipFile(baseApk);
             ZipOutputStream zos = new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(outputApk)))) {

            // 1. Copy all entries from base.apk, preserving STORED vs DEFLATED methods
            var entries = zipFile.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                String cleanName = entry.getName().replace('\\', '/');
                if (cleanName.startsWith("/")) cleanName = cleanName.substring(1);

                byte[] data;
                try (InputStream is = zipFile.getInputStream(entry)) {
                    data = is.readAllBytes();
                }

                ZipEntry newEntry = new ZipEntry(cleanName);
                newEntry.setMethod(entry.getMethod());
                if (entry.getMethod() == ZipEntry.STORED) {
                    newEntry.setSize(data.length);
                    newEntry.setCompressedSize(data.length);
                    CRC32 crc = new CRC32();
                    crc.update(data);
                    newEntry.setCrc(crc.getValue());
                }

                zos.putNextEntry(newEntry);
                zos.write(data);
                zos.closeEntry();
            }

            // 2. Add classes.dex
            if (dexFile.exists()) {
                ZipEntry dexEntry = new ZipEntry("classes.dex");
                dexEntry.setMethod(ZipEntry.DEFLATED);
                zos.putNextEntry(dexEntry);
                Files.copy(dexFile.toPath(), zos);
                zos.closeEntry();
            }

            // 3. Add assets recursively with POSIX forward slashes
            if (assetsDir.exists() && assetsDir.isDirectory()) {
                byte[] buffer = new byte[8192];
                addDirectory(assetsDir, "assets", zos, buffer);
            }
        }
    }

    private static void addDirectory(File dir, String base, ZipOutputStream zos, byte[] buffer) throws Exception {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File file : files) {
            String entryName = base + "/" + file.getName();
            if (file.isDirectory()) {
                addDirectory(file, entryName, zos, buffer);
            } else {
                ZipEntry entry = new ZipEntry(entryName);
                entry.setMethod(ZipEntry.DEFLATED);
                zos.putNextEntry(entry);
                try (InputStream fis = new BufferedInputStream(new FileInputStream(file))) {
                    int len;
                    while ((len = fis.read(buffer)) > 0) {
                        zos.write(buffer, 0, len);
                    }
                }
                zos.closeEntry();
            }
        }
    }
}
