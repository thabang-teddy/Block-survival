Shader "BlockSurvival/VertexColorTransparent"
{
    // Twin of VertexColorOpaque.shader for water/glass/leaves — alpha comes
    // from the mesher's per-block alpha (palette.ts), not a texture.
    SubShader
    {
        Tags { "RenderType" = "Transparent" "Queue" = "Transparent" }
        Cull Off
        ZWrite Off
        Blend SrcAlpha OneMinusSrcAlpha

        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            struct appdata
            {
                float4 vertex : POSITION;
                float4 color : COLOR;
                float3 normal : NORMAL;
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float4 color : COLOR;
                float3 worldNormal : TEXCOORD0;
            };

            v2f vert(appdata v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.color = v.color;
                o.worldNormal = UnityObjectToWorldNormal(v.normal);
                return o;
            }

            fixed4 frag(v2f i) : SV_Target
            {
                float lightTerm = dot(normalize(i.worldNormal), normalize(float3(0.4, 0.8, 0.3))) * 0.5 + 0.5;
                return fixed4(i.color.rgb * lightTerm, i.color.a);
            }
            ENDCG
        }
    }
}
