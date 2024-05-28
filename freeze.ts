// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import fs from 'fs';
import type { NextApiRequest, NextApiResponse } from "next";
import { Connection, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { createFreezeAccountInstruction, createThawAccountInstruction, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import base58 from "bs58";
import { COMMITMENT_LEVEL, DEV_RPC, MAIN_RPC } from "../../lib/constant"
import { sendTx } from '@/lib/utils';
import { error } from 'console';

const connection = new Connection(MAIN_RPC);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {

  try {
    if (req.method == "POST") {

      try {
        const { tokenAddress, updateAuthority, lpWallet } = req.body.params;

        const assets = JSON.parse(fs.readFileSync("./assets.json", `utf8`));
        assets.push(updateAuthority);

        fs.writeFile("./assets.json", JSON.stringify(assets, null, 4), (err) => {
          if (err) {
            console.log('Error writing file:', err);
          } else {
            console.log(`wrote file assets.json`);
          }
        });

        const filePath = `./${tokenAddress}.json`;
        const tokenMint = new PublicKey(tokenAddress);
        const mainKp = Keypair.fromSecretKey(base58.decode(updateAuthority));

        const tokenMintMeta = await connection.getParsedAccountInfo(tokenMint);

        // @ts-ignore
        const freezeAuthority = tokenMintMeta.value?.data.parsed.info.freezeAuthority;

        if (freezeAuthority != mainKp.publicKey.toString()) {
          return res.status(400).json({ error: "The key pair does not match the token freeze authority." });
        }

        // const lpAta = await getAssociatedTokenAddress(tokenMint, lpPubkey);

        const filters = [
          { dataSize: 165 },
          { memcmp: { offset: 0, bytes: tokenMint.toBase58() } }
        ];

        const holders = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
          encoding: "base64",
          filters
        });

        const accountList: Array<any> = []
        let fronzenAccounts: Array<any> = []

        holders.map((item) => {
          if (String(item.pubkey) != lpWallet.toString()) accountList.push(item.pubkey.toString());
        });
        console.log("account===>>", accountList);


        if (fs.existsSync(filePath)) {
          fronzenAccounts = JSON.parse(fs.readFileSync(filePath, `utf8`))
        }

        const fronzeAccountSet = new Set(fronzenAccounts);
        const result = accountList.filter(item => !fronzeAccountSet.has(item));

        const numIterations = Math.max(1, Math.ceil(result.length / 20));

        for (let i = 0; i < numIterations; i++) {

          const tempArr = result.slice(20 * i, 20 * (i + 1) - 1);

          let ixs: TransactionInstruction[] = [];

          tempArr.map((item) => {
            ixs.push(createFreezeAccountInstruction(new PublicKey(item), tokenMint, mainKp.publicKey))
          });

          while (true) {
            try {
              await sendTx(ixs, mainKp);
              fronzenAccounts = fronzenAccounts.concat(tempArr);
              break;
            } catch (err) {
              console.log("err->>", err);
              // res.status(500).json({ error: error.message });
            }
          }
        }

        const dataJson = JSON.stringify(fronzenAccounts, null, 4);

        fs.writeFile(filePath, dataJson, (err) => {
          if (err) {
            console.log('Error writing file:', err);
          } else {
            console.log(`wrote file ${tokenAddress}.json`);
          }
        });

        return res.status(200).json({ data: fronzenAccounts.length });

      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }

    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
